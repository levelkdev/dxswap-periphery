mkdir -p contracts/.flattened
npx hardhat flatten contracts/DXswapRouter.sol > contracts/.flattened/DXswapRouter.sol
npx hardhat flatten contracts/libraries/DXswapLibrary.sol > contracts/.flattened/DXswapLibrary.sol
npx hardhat flatten contracts/libraries/DXswapOracleLibrary.sol > contracts/.flattened/DXswapOracleLibrary.sol
npx hardhat flatten contracts/examples/DXswapRelayer.sol > contracts/.flattened/DXswapRelayer.sol
npx hardhat flatten contracts/examples/OracleCreator.sol > contracts/.flattened/OracleCreator.sol
