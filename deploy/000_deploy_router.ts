import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { contractConstructorArgs, getDeploymentConfig, TAGS } from "./deployment.config";
import { runVerify } from "./utils";
import { DXswapRouter__factory } from "../typechain";


const deployment: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();

    const config = getDeploymentConfig(network.name);

    const constructorArgs = contractConstructorArgs<DXswapRouter__factory>(
        config?.dxSwapFactory || deployer,
        config?.nativeCurrencyWrapper || deployer
    );

    const deployResult = await deploy("DXswapRouter", {
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

deployment.tags = [TAGS.ROUTER, TAGS.PERIPHERY];

export default deployment;
