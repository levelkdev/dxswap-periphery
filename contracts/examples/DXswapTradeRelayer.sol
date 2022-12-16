pragma solidity =0.8.16;
pragma experimental ABIEncoderV2;

import './OracleCreator.sol';
import './../interfaces/IDXswapFactory.sol';
import './../interfaces/IDXswapRouter.sol';
import './../libraries/TransferHelper.sol';
import './../interfaces/IERC20.sol';
import './../interfaces/IWETH.sol';
import './../libraries/DXswapLibrary.sol';

contract DXswapTradeRelayer {
    event NewOrder(uint256 indexed _orderIndex);
    event ExecutedOrder(uint256 indexed _orderIndex);
    event WithdrawnExpiredOrder(uint256 indexed _orderIndex);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Details(uint256 amountIn, uint256 amountOut);

    struct Order {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 priceTolerance;
        uint256 minReserveA;
        uint256 minReserveB;
        address oraclePair;
        uint256 deadline;
        uint256 maxWindowTime;
        uint256 oracleId;
        address factory;
        bool executed;
    }

    uint256 public immutable GAS_ORACLE_UPDATE = 168364;
    uint256 public immutable PARTS_PER_MILLION = 1000000;
    uint256 public immutable BOUNTY = 0.01 ether;
    uint8 public immutable PROVISION = 1;
    uint8 public immutable REMOVAL = 2;

    address public immutable dxSwapFactory;
    address public immutable dxSwapRouter;
    address public immutable uniswapFactory;
    address public immutable uniswapRouter;
    address public immutable WETH;

    OracleCreator oracleCreator;
    uint256 public orderCount;
    mapping(uint256 => Order) orders;
    address payable public owner;

    constructor(
        address payable _owner,
        address _dxSwapFactory,
        address _dxSwapRouter,
        address _uniswapFactory,
        address _uniswapRouter,
        address _WETH,
        OracleCreator _oracleCreator
    ) {
        owner = _owner;
        dxSwapFactory = _dxSwapFactory;
        dxSwapRouter = _dxSwapRouter;
        uniswapFactory = _uniswapFactory;
        uniswapRouter = _uniswapRouter;
        WETH = _WETH;
        oracleCreator = _oracleCreator;
    }

    function createSwapOrder(
        address tokenA,
        address tokenB,
        uint256 amountInTokenA,
        uint256 amountInTokenB,
        uint256 priceTolerance,
        uint256 minReserveA,
        uint256 minReserveB,
        uint256 maxWindowTime,
        uint256 deadline,
        address factory
    ) external payable returns (uint256 orderIndex) {
        require(factory == dxSwapFactory || factory == uniswapFactory, 'DXswapRelayer: INVALID_FACTORY');
        require(msg.sender == owner, 'DXswapRelayer: CALLER_NOT_OWNER');
        require(tokenA != tokenB, 'DXswapRelayer: INVALID_PAIR');
        require(tokenA < tokenB, 'DXswapRelayer: INVALID_TOKEN_ORDER');
        // only one token amount can be > 0 and second token amount is calculated as output
        require(
            (amountInTokenA > 0 && amountInTokenB == 0) || (amountInTokenA == 0 && amountInTokenB > 0),
            'DXswapRelayer: INVALID_TOKEN_AMOUNT'
        );
        require(priceTolerance <= PARTS_PER_MILLION, 'DXswapRelayer: INVALID_TOLERANCE');
        require(block.timestamp <= deadline, 'DXswapRelayer: DEADLINE_REACHED');
        require(maxWindowTime > 30, 'DXswapRelayer: INVALID_WINDOWTIME');

        (address tokenIn, address tokenOut, uint256 amountIn) = amountInTokenA > 0
            ? (tokenA, tokenB, amountInTokenA)
            : (tokenB, tokenA, amountInTokenB);

        if (tokenIn == address(0)) {
            require(address(this).balance >= amountIn, 'DXswapRelayer: INSUFFICIENT_ETH');
        } else {
            require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn, 'DXswapRelayer: INSUFFICIENT_TOKEN');
        }

        address pair = _pair(tokenA, tokenB, factory);

        require(pair != address(0), 'DXswapRelayer: INVALID_PAIR_ADDRESS');

        orderIndex = _OrderIndex();
        orders[orderIndex] = Order({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            priceTolerance: priceTolerance,
            minReserveA: minReserveA,
            minReserveB: minReserveB,
            oraclePair: pair,
            deadline: deadline,
            maxWindowTime: maxWindowTime,
            oracleId: 0,
            factory: factory,
            executed: false
        });

        (uint256 reserveA, uint256 reserveB, ) = IDXswapPair(pair).getReserves();

        /* Create an oracle to calculate average price before swap */
        uint256 windowTime = _consultOracleParameters(amountIn, reserveA, reserveB, maxWindowTime);
        orders[orderIndex].oracleId = oracleCreator.createOracle(windowTime, pair);
        emit NewOrder(orderIndex);
    }

    function executeOrder(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(orderIndex < orderCount, 'DXswapRelayer: INVALID_ORDER');
        require(!order.executed, 'DXswapRelayer: ORDER_EXECUTED');
        require(oracleCreator.isOracleFinalized(order.oracleId), 'DXswapRelayer: OBSERVATION_RUNNING');
        require(block.timestamp <= order.deadline, 'DXswapRelayer: DEADLINE_REACHED');

        address tokenIn = order.tokenIn;
        uint256 amountOut;
        amountOut = oracleCreator.consult(
            order.oracleId,
            tokenIn == address(0) ? IDXswapRouter(dxSwapRouter).WETH() : tokenIn,
            order.amountIn
        );

        uint256 minAmountOut = amountOut - ((amountOut * (order.priceTolerance)) / PARTS_PER_MILLION);

        order.executed = true;

        _swap(tokenIn, order.tokenOut, order.amountIn, minAmountOut, order.factory);

        emit ExecutedOrder(orderIndex);
    }

    // Updates a price oracle and sends a bounty to msg.sender
    function updateOracle(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(block.timestamp <= order.deadline, 'DXswapRelayer: DEADLINE_REACHED');
        require(!oracleCreator.isOracleFinalized(order.oracleId), 'DXswapRelayer: OBSERVATION_ENDED');
        uint256 amountBounty = GAS_ORACLE_UPDATE * (block.basefee) + (BOUNTY);

        (uint256 reserveA, uint256 reserveB, ) = IDXswapPair(order.oraclePair).getReserves();
        require(reserveA >= order.minReserveA && reserveB >= order.minReserveB, 'DXswapRelayer: RESERVE_TOO_LOW');

        oracleCreator.update(order.oracleId);
        if (address(this).balance >= amountBounty) {
            TransferHelper.safeTransferETH(msg.sender, amountBounty);
        }
    }

    function withdrawExpiredOrder(uint256 orderIndex) external {
        Order storage order = orders[orderIndex];
        require(msg.sender == owner, 'DXswapRelayer: CALLER_NOT_OWNER');
        require(block.timestamp > order.deadline, 'DXswapRelayer: DEADLINE_NOT_REACHED');
        require(order.executed == false, 'DXswapRelayer: ORDER_EXECUTED');
        address tokenIn = order.tokenIn;
        uint256 amountIn = order.amountIn;
        order.executed = true;

        if (tokenIn == address(0)) {
            TransferHelper.safeTransferETH(owner, amountIn);
        } else {
            TransferHelper.safeTransfer(tokenIn, owner, amountIn);
        }
        emit WithdrawnExpiredOrder(orderIndex);
    }

    function _swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        uint256 _minAmountOut,
        address _factory
    ) internal {
        uint256[] memory amounts;
        address[] memory path = new address[](2);

        // factory can be only dxswap or uniswap
        address swapRouter = _factory == dxSwapFactory ? dxSwapRouter : uniswapRouter;
        address tokenIn = _tokenIn == address(0) ? WETH : _tokenIn;

        path[0] = tokenIn;
        path[1] = _tokenOut;

        TransferHelper.safeApprove(tokenIn, swapRouter, _amountIn);

        if (_tokenIn == address(0)) {
            amounts = IDXswapRouter(swapRouter).swapExactETHForTokens{value: _amountIn}(
                _minAmountOut,
                path,
                address(this),
                block.timestamp
            );
        } else {
            amounts = IDXswapRouter(swapRouter).swapExactTokensForTokens(
                _amountIn,
                _minAmountOut,
                path,
                address(this),
                block.timestamp
            );
        }
    }

    // Internal function to calculate the optimal time window for price observation
    function _consultOracleParameters(
        uint256 amountIn,
        uint256 reserveA,
        uint256 reserveB,
        uint256 maxWindowTime
    ) internal pure returns (uint256 windowTime) {
        if (reserveA > 0 && reserveB > 0) {
            uint256 poolStake = ((amountIn) * (PARTS_PER_MILLION)) / reserveA + (reserveB);
            // poolStake: 0.1% = 1000; 1=10000; 10% = 100000;
            if (poolStake < 1000) {
                windowTime = 30;
            } else if (poolStake < 2500) {
                windowTime = 60;
            } else if (poolStake < 5000) {
                windowTime = 90;
            } else if (poolStake < 10000) {
                windowTime = 120;
            } else {
                windowTime = 150;
            }
            windowTime = windowTime <= maxWindowTime ? windowTime : maxWindowTime;
        } else {
            windowTime = maxWindowTime;
        }
    }

    // Internal function to return the correct pair address on either DXswap or Uniswap
    function _pair(address tokenA, address tokenB, address factory) internal view returns (address pair) {
        require(factory == dxSwapFactory || factory == uniswapFactory, 'DXswapRelayer: INVALID_FACTORY');
        if (tokenA == address(0)) tokenA = WETH;
        pair = IDXswapFactory(factory).getPair(tokenA, tokenB);
    }

    // Returns an OrderIndex that is used to reference liquidity orders
    function _OrderIndex() internal returns (uint256 orderIndex) {
        orderIndex = orderCount;
        orderCount++;
    }

    // Returns the data of one specific order
    function GetOrderDetails(uint256 orderIndex) external view returns (Order memory) {
        return orders[orderIndex];
    }

    function transferOwnership(address payable _newOwner) external {
        require(msg.sender == owner, 'Ownable: caller is not the owner');
        address _oldOwner = owner;
        owner = _newOwner;
        emit OwnershipTransferred(_oldOwner, _newOwner);
    }

    receive() external payable {}
}
