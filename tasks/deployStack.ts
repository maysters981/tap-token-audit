import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Multicall3 } from 'tapioca-sdk/dist/typechain/utils/MultiCall';
import { buildTapOFT } from './deploy/01-buildTapOFT';
import { buildTOLP } from './deploy/02-buildTOLP';
import { buildOTAP } from './deploy/03-buildOTAP';
import { buildTOB } from './deploy/04-buildTOB';
import { buildAfterDepSetup } from './deploy/05-buildAfterDepSetup';
import { buildYieldBoxMock } from './deploy/901-buildYieldBoxMock';
import { buildTestnetDeployment } from './deploy/902-buildTestnetDeployment';
import { buildTestnetAfterDepSetup } from './deploy/99-buildTestnetAfterDepSetup';
import { typechain } from 'tapioca-sdk';

// hh deployStack --type build --network goerli
export const deployStack__task = async (
    taskArgs: { type: 'build' | 'load' },
    hre: HardhatRuntimeEnvironment,
) => {
    // Settings
    const signer = (await hre.ethers.getSigners())[0];
    const multicall = typechain.Multicall.Multicall3__factory.connect(
        hre.SDK.config.MULTICALL_ADDRESS,
        signer,
    );
    const VM = new hre.SDK.DeployerVM(hre, {
        // Change this if you get bytecode size error / gas required exceeds allowance (550000000)/ anything related to bytecode size
        // Could be different by network/RPC provider
        bytecodeSizeLimit: 95_000,
        multicall,
    });

    if (taskArgs.type === 'build') {
        // TODO - To remove
        // Build YieldBox on the go:)
        const yb = await buildYieldBoxMock(hre);
        VM.add(yb[0]).add(yb[1]);

        // Build contracts
        VM.add(await buildTapOFT(hre, signer.address))
            .add(await buildTOLP(hre, signer.address))
            .add(await buildOTAP(hre))
            .add(await buildTOB(hre, signer.address, signer.address));


        // Add and execute
        await VM.execute(3);
        VM.save();
        await VM.verify();
    } else {
        const data = hre.SDK.db.loadLocalDeployment(
            'default',
            String(hre.network.config.chainId),
        );
        VM.load(data);
    }

    const vmList = VM.list();
    // After deployment setup
    const calls: Multicall3.Call3Struct[] = [
        ...(await buildAfterDepSetup(hre, vmList)),
    ];

    // Execute
    console.log('[+] After deployment setup calls number: ', calls.length);
    try {
        const tx = await (await multicall.aggregate3(calls)).wait(1);
        console.log(
            '[+] After deployment setup multicall Tx: ',
            tx.transactionHash,
        );
    } catch (e) {
        // If one fail, try them one by one
        for (const call of calls) {
            await (
                await signer.sendTransaction({
                    data: call.callData,
                    to: call.target,
                })
            ).wait();
        }
    }

    console.log('[+] Stack deployed! 🎉');
};
