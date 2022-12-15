import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { contractConstructorArgs, getDeploymentConfig, TAGS } from "./deployment.config";
import { runVerify } from "./utils";
import { DXswapRelayer__factory } from "../typechain";


const deployment: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();

    const config = getDeploymentConfig(network.name);

    const constructorArgs = contractConstructorArgs<DXswapRelayer__factory>(
        config?.owner || deployer,
        config?.dxSwapFactory || deployer,
        config?.dxSwapRouter || deployer,
        config?.uniswapFactory || deployer,
        config?.uniswapRouter || deployer,
        config?.nativeCurrencyWrapper || deployer,
        config?.oracleCreator || deployer,
    );

    const deployResult = await deploy("DXswapRelayer", {
        from: deployer,
        args: constructorArgs,
        log: true,
    });

    if (deployResult.newlyDeployed && deployResult.transactionHash) {
        await runVerify(hre, deployResult.transactionHash, {
            address: deployResult.address,
            constructorArguments: constructorArgs,
        });
    }
};

deployment.tags = [TAGS.RELAYER, TAGS.PERIPHERY];

export default deployment;
