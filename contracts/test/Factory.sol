pragma solidity >=0.5.16;

import "@swapr/core/contracts/DXswapPair.sol";
import "@swapr/core/contracts/DXswapFactory.sol";

contract Factory is IDXswapFactory {
    address public feeTo;
    address public feeToSetter;
    uint8 public protocolFeeDenominator = 9; // uses ~10% of each swap fee
    bytes32 public constant INIT_CODE_PAIR_HASH =
        keccak256(abi.encodePacked(type(DXswapPair).creationCode));

    mapping(address => mapping(address => address)) public getPair;
    DXswapPair[] public allPairs;

    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }
}
