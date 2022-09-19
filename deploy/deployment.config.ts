/* eslint-disable no-unused-vars */
import { ContractFactory } from "ethers";

export enum TAGS {
    PERIPHERY = "PERIPHERY", // full deploy
    ROUTER = "ROUTER",
    ROUTER_FACTORY = "ROUTER_FACTORY",
    RELAYER = "RELAYER",
    RELAYER_FACTORY = "RELAYER_FACTORY",
    ORACLE_CREATOR = "ORACLE_CREATOR",
    ORACLE_CREATOR_FACTORY = "ORACLE_CREATOR_FACTORY"
}

type PeripheryDeployParams = Partial<{
    owner: string;
    dxSwapFactory: string;
    dxSwapRouter: string;
    uniswapFactory: string;
    uniswapRouter: string;
    nativeCurrencyWrapper: string;
    oracleCreator: string; 
}>;

const deploymentConfig: { [k: string]: PeripheryDeployParams } = {
    mainnet: {
        owner: "0x519b70055af55A007110B4Ff99b0eA33071c720a",
        dxSwapFactory: "0xd34971BaB6E5E356fd250715F5dE0492BB070452",
        dxSwapRouter: "0xB9960d9bcA016e9748bE75dd52F02188B9d0829f",
        uniswapFactory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        nativeCurrencyWrapper: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        oracleCreator: "0xACE19569805fDc5F8bb778C15Ee94F2F61D78392"
    },
    gnosis: {
        owner: "0xe716EC63C5673B3a4732D22909b38d779fa47c3F",
        dxSwapFactory: "0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179",
        dxSwapRouter: "0xE43e60736b1cb4a75ad25240E2f9a62Bff65c0C0",
        uniswapFactory: "0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7",
        uniswapRouter: "0x1C232F01118CB8B424793ae03F870aa7D0ac7f77",
        nativeCurrencyWrapper: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
        oracleCreator: "0xa1A98682DdDDD197B2807094FEBBa318E43d0de1"
    },
    arbitrum: {
        owner: "0xbf7454c656BDB7C439E8d759c18Ac240398FdE35",
        dxSwapFactory: "0x359F20Ad0F42D75a5077e65F30274cABe6f4F01a",
        dxSwapRouter: "0x530476d5583724A89c8841eB6Da76E7Af4C0F17E",
        nativeCurrencyWrapper: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    },
};

export const getDeploymentConfig = (networkName: string) => {
    return deploymentConfig[networkName] || undefined;
};

export const contractConstructorArgs = <T extends ContractFactory>(
    ...args: Parameters<T["deploy"]>
) => args;