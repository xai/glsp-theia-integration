/********************************************************************************
 * Copyright (c) 2020-2023 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { Channel, Disposable, MaybePromise } from '@theia/core';
import { ForwardingChannel } from '@theia/core/lib/common/message-rpc/channel';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { RawProcess } from '@theia/process/lib/node/raw-process';
import * as fs from 'fs';
import * as net from 'net';
import { BaseGLSPServerContribution, GLSPServerContributionOptions } from './glsp-server-contribution';
import { SocketConnectionForwarder } from './socket-connection-forwarder';

/**
 * Message that is expected to be printed by the embedded server process to the stdout once the
 * server process startup routine has been completed and is ready to accept incoming connections.
 */
export const START_UP_COMPLETE_MSG = '[GLSP-Server]:Startup completed';

export interface GLSPSocketServerContributionOptions extends GLSPServerContributionOptions {
    /**
     * Path to the location of the server executable that should be launched as process
     * Has to be either be a *.jar (Java) or *.js (Node ) file.
     */
    executable?: string;

    /** Socket connection options for new client connections */
    socketConnectionOptions: net.TcpSocketConnectOpts;

    /** Additional arguments that should be passed when starting the server process. */
    additionalArgs?: string[];
}

export namespace GLSPSocketServerContributionOptions {
    /** Default values for {@link JavaGLSPServerLaunchOptions }**/
    export function createDefaultOptions(): GLSPSocketServerContributionOptions {
        return {
            ...GLSPServerContributionOptions.createDefaultOptions(),
            socketConnectionOptions: {
                port: NaN
            }
        };
    }

    /**
     * Utility function to partially set the launch options. Default values (from 'defaultOptions') are used for
     * options that are not specified.
     * @param options (partial) launch options that should be extended with default values (if necessary)
     */
    export function configure(options?: Partial<GLSPSocketServerContributionOptions>): GLSPSocketServerContributionOptions {
        return {
            ...createDefaultOptions(),
            ...options
        };
    }
}

/**
 *  A reusable base implementation for {@link GLSPServerContribution}s that are using a socket connection to communicate
 *  with a Java or Node based GLSP server.
 **/
@injectable()
export abstract class GLSPSocketServerContribution extends BaseGLSPServerContribution {
    override options: GLSPSocketServerContributionOptions;
    protected onReadyDeferred = new Deferred<void>();

    @postConstruct()
    protected override initialize(): void {
        this.options = GLSPSocketServerContributionOptions.configure(this.createContributionOptions());
    }

    abstract override createContributionOptions(): Partial<GLSPSocketServerContributionOptions>;

    connect(clientChannel: Channel): MaybePromise<void> {
        return this.connectToSocketServer(clientChannel);
    }

    async launch(): Promise<void> {
        try {
            if (!this.options.executable) {
                throw new Error('Could not launch GLSP server. No executable path is provided via the contribution options');
            }
            if (!fs.existsSync(this.options.executable)) {
                throw new Error(`Could not launch GLSP server. The given server executable path is not valid: ${this.options.executable}`);
            }
            if (isNaN(this.options.socketConnectionOptions.port)) {
                throw new Error(
                    `Could not launch GLSP Server. The given server port is not a number: ${this.options.socketConnectionOptions.port}`
                );
            }

            if (this.options.executable.endsWith('.jar')) {
                await this.launchJavaProcess();
            } else if (this.options.executable.endsWith('.js')) {
                await this.launchNodeProcess();
            } else {
                throw new Error(`Could not launch GLSP Server. Invalid executable path ${this.options.executable}`);
            }
        } catch (error) {
            this.onReadyDeferred.reject(error);
        }

        return this.onReadyDeferred.promise;
    }

    protected launchJavaProcess(): Promise<RawProcess> {
        const args = [
            ...this.getJavaProcessJvmArgs(),
            '-jar',
            this.options.executable!,
            '--port',
            `${this.options.socketConnectionOptions.port}`
        ];

        if (this.options.socketConnectionOptions.host) {
            args.push('--host', `${this.options.socketConnectionOptions.host}`);
        }

        if (this.options.additionalArgs) {
            args.push(...this.options.additionalArgs);
        }
        return this.spawnProcessAsync('java', args);
    }

    protected getJavaProcessJvmArgs(): string[] {
        return ['--add-opens', 'java.base/java.util=ALL-UNNAMED'];
    }

    protected launchNodeProcess(): Promise<RawProcess> {
        const args = [this.options.executable!, '--port', `${this.options.socketConnectionOptions.port}`];

        if (this.options.socketConnectionOptions.host) {
            args.push('--host', `${this.options.socketConnectionOptions.host}`);
        }

        if (this.options.additionalArgs) {
            args.push(...this.options.additionalArgs);
        }
        return this.spawnProcessAsync('node', args);
    }

    protected override processLogInfo(line: string): void {
        if (line.startsWith(START_UP_COMPLETE_MSG)) {
            this.onReadyDeferred.resolve();
        }
    }

    protected async connectToSocketServer(clientChannel: Channel): Promise<void> {
        if (isNaN(this.options.socketConnectionOptions.port)) {
            throw new Error(
                // eslint-disable-next-line max-len
                `Could not connect to to GLSP Server. The given server port is not a number: ${this.options.socketConnectionOptions.port}`
            );
        }
        const socket = new net.Socket();

        this.forward(clientChannel, socket);
        if (clientChannel instanceof ForwardingChannel) {
            socket.on('error', error => clientChannel.onErrorEmitter.fire(error));
        }
        socket.connect(this.options.socketConnectionOptions);
        this.toDispose.push(Disposable.create(() => socket.destroy()));
    }

    protected forward(clientChannel: Channel, socket: net.Socket): void {
        this.toDispose.push(new SocketConnectionForwarder(clientChannel, socket));
    }
}

/**
 * Utility function to parse a server port that is defined via command line arg.
 * @param argsKey Name/Key of the commandLine arg
 * @param defaultPort Default port that should be returned if no (valid) port was passed via CLI
 */
export function getPort(argsKey: string, defaultPort?: number): number {
    argsKey = `--${argsKey.replace('--', '').replace('=', '')}=`;
    const args = process.argv.filter(a => a.startsWith(argsKey));
    if (args.length > 0) {
        return Number.parseInt(args[0].substring(argsKey.length), 10);
    }
    return defaultPort ? defaultPort : NaN;
}
