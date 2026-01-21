/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2026 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const path = require('path');
const util = require('util');
const Cmd = require('@ntlab/ntlib/cmd');
const Configuration = require('./configuration');
const Work = require('@ntlab/work/work');
const SipdCmd = require('../cmd');
const SipdQueue = require('./queue');
const SipdBridge = require('../bridge');
const SipdSppBridge = require('../bridge/spp');
const SipdLpjBridge = require('../bridge/lpj');
const SipdUtilBridge = require('../bridge/util');
const { Socket } = require('socket.io');
const debug = require('debug')('sipd:app');

/**
 * Main application entry point.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class App {

    VERSION = 'SIPD-BRIDGE-4.2'

    /** @type {Configuration} */
    config = {}
    /** @type {SipdBridge[]} */
    bridges = []
    /** @type {Socket[]} */
    sockets = []
    sessions = {}

    /**
     * Constructor.
     *
     * @param {string} rootDir Application configuration root directory
     */
    constructor(rootDir) {
        this.rootDir = rootDir;
    }

    initialize() {
        this.config = new Configuration(this.rootDir);
        this.config
            .applyServerKeys()
            .applyProfile()
            .applySolver();
        return this.config.initialized;
    }

    createDequeuer() {
        this.dequeue = SipdQueue.createDequeuer();
        this.dequeue.setInfo({
            version: this.VERSION,
            ready: () => this.ready ? 'Yes' : 'No',
            captcha: () => this.getCaptcha(),
        });
        this.dequeue.createQueue = (data, ret) => {
            let res;
            const queue = this.dequeue.createNewQueue(data);
            if (queue) {
                if (data.id) {
                    queue.id = data.id;
                }
                if (SipdQueue.hasPendingQueue(queue)) {
                    res = {message: `Antrian ${queue.id} sudah dalam antrian atau sedang diproses!`};
                }
                if (res === undefined) {
                    console.log(`📦 ${queue.type.toUpperCase()}: ${queue.info ?? '\u2014'}`);
                    res = SipdQueue.addQueue(queue);
                }
            }
            return ret ? [res, queue] : res;
        }
        /**
         * @param {SipdQueue} queue
         */
        this.dequeue.setMaps = queue => {
            queue.maps = this.config.maps;
            queue.info = queue.getMappedData('info.title');
        }
        this.dequeue
            .on('queue', () => this.handleNotify())
            .on('queue-done', () => this.handleNotify())
            .on('queue-error', () => this.handleNotify())
        ;
        if (Cmd.get('queue')) {
            const f = () => {
                console.log('Please wait, saving queues...');
                this.dequeue.saveQueue();
                this.dequeue.saveLogs();
                process.exit();
            }
            process.on('SIGINT', () => f());
            process.on('SIGTERM', () => f());
        }
    }

    createBridges() {
        let seq = 0;
        for (const [name, options] of Object.entries(this.config.bridges)) {
            const id = `bridge${++seq}`;
            const config = Object.assign({}, this.config, options);
            if (config.enabled !== undefined && !config.enabled) {
                continue;
            }
            const browser = config.browser ? config.browser : 'default';
            if (browser) {
                config.profiledir = path.join(this.config.profiledir, id);
                if (!this.sessions[id]) {
                    this.sessions[id] = {};
                }
                if (!this.sessions[id][browser]) {
                    this.sessions[id][browser] = 0;
                }
                this.sessions[id][browser]++;
                if (this.sessions[id][browser] > 1) {
                    config.session = 's' + this.sessions[id][browser];
                }
            }
            let bridge;
            switch (this.config.mode) {
                case Configuration.BRIDGE_SPP:
                    bridge = new SipdSppBridge(name, config);
                    break;
                case Configuration.BRIDGE_LPJ:
                    bridge = new SipdLpjBridge(name, config);
                    break;
                case Configuration.BRIDGE_UTIL:
                    bridge = new SipdUtilBridge(name, config);
                    break;
            }
            if (bridge) {
                bridge.year = config.year;
                bridge.onState = () => this.handleNotify();
                this.bridges.push(bridge);
                console.log('Sipd bridge created: %s', name);
            }
        }
    }

    createServer(serve = true) {
        const { createServer } = require('http');
        const { Server } = require('socket.io');
        const http = createServer();
        const port = Cmd.get('port') || 4000;
        if (serve) {
            const opts = {};
            if (this.config.rootPath) {
                opts.path = this.config.getPath('/socket.io/');
            }
            if (this.config.cors) {
                opts.cors = this.config.cors;
            } else {
                opts.cors = {origin: '*'};
            }
            const io = new Server(http, opts);
            const ns = io.of('/sipd')
                .on('connection', socket => {
                    this.handleConnection(socket);
                })
            ;
            if (this.config.token) {
                ns.use((socket, next) => {
                    const auth = socket.handshake.headers.authorization;
                    if (auth) {
                        const token = auth.replace('Bearer ', '');
                        if (token === this.config.token) {
                            return next();
                        }
                    }
                    debug('Client %s is using invalid authorization', socket.id);
                    next(new Error('Invalid authorization'));
                });
            }
        }
        http.listen(port, () => {
            console.log('Application ready on port %s...', port);
            const selfTests = [];
            this.bridges.forEach(bridge => {
                selfTests.push(w => bridge.selfTest());
            });
            Work.works(selfTests)
                .then(() => {
                    if (Cmd.get('queue')) {
                        this.dequeue.loadQueue();
                    }
                    if (Cmd.get('noop')) {
                        console.log('Bridge ready, queuing only...');
                    } else {
                        console.log('Queue processing is ready...');
                        this.registerConsumers();
                    }
                })
                .catch(err => {
                    if (err) {
                        console.error('Self test reaches an error: %s!', err);
                    } else {
                        console.error('Self test reaches an error!');
                    }
                })
            ;
            this.checkReadiness();
        });
    }

    createCleanQueue() {
        return this.dequeue.createQueue({type: SipdQueue.QUEUE_CLEAN, data: {dir: this.config.profiledir}});
    }

    registerCommands() {
        const prefixes = {
            [Configuration.BRIDGE_SPP]: 'spp',
            [Configuration.BRIDGE_LPJ]: 'lpj',
            [Configuration.BRIDGE_UTIL]: 'util',
        }
        SipdCmd.register(this, prefixes[this.config.mode]);
    }

    processArguments() {
        let serve = true, res, command, data, opts, error;
        if (Cmd.args.length) {
            switch (this.config.mode) {
                case Configuration.BRIDGE_SPP:
                    res = this.doSppOp(...Cmd.args);
                    break;
                case Configuration.BRIDGE_LPJ:
                    res = this.doLpjOp(...Cmd.args);
                    break;
                case Configuration.BRIDGE_UTIL:
                    res = this.doUtilOp(...Cmd.args);
                    break;
            }
        }
        if (Array.isArray(res)) {
            [serve, command, data, opts, error] = res;
        }
        if (command && !error) {
            this.payload = {
                command,
                params: {
                    data: {
                        year: new Date().getFullYear(),
                        timeout: 0,
                        ...(data || {})
                    },
                    ...(opts || {})
                }
            }
        } else if (error || !serve) {
            if (error) {
                console.error(error);
            }
            process.exit();
        }
        return serve;
    }

    doSppOp(...args) {
        let command = 'spp:query', data = {}, opts = {}, error;
        if (args.length === 2) {
            const queue = SipdQueue.createWithMap(this.config.maps);
            data[queue.getMap('info.role')] = args[0];
            data[queue.getMap('info.check')] = args[1];
            opts.filename = Cmd.get('out') ?? path.join(this.config.workdir, 'out.json');
        } else {
            error = 'SPP query requires KEG and SPP/SPM/SP2D number!';
        }
        return [false, command, data, opts, error];
    }

    doLpjOp(...args) {
    }

    doUtilOp(...args) {
        let command, data = {}, opts = {}, error;
        const cmd = args.shift();
        switch (cmd) {
            case 'captcha':
                command = 'util:captcha';
                data.count = Cmd.get('count') ? parseInt(Cmd.get('count')) : 10;
                break;
            case 'noop':
                command = 'util:noop';
                break;
            case 'rekanan':
                if (args.length) {
                    command = cmd;
                    const queue = SipdQueue.createWithMap(this.config.maps);
                    data[queue.getMap('info.jenis')] = 'orang';
                    data[queue.getMap('info.role')] = args[0];
                    if (args.length > 1) {
                        data[queue.getMap('info.nik')] = args[1];
                    }
                    opts.filename = Cmd.get('out') ?? path.join(this.config.workdir, 'out.json');
                } else {
                    error = 'Partner utility requires KEG and an optional NIK!';
                }
                break;
            default:
                error = 'Supported utility: captcha, noop, rekanan!';
                break;
        }
        return [false, command, data, opts, error];
    }

    checkReadiness() {
        const readinessTimeout = this.config.readinessTimeout || 30000; // 30 seconds
        this.startTime = Date.now();
        const interval = setInterval(() => {
            const now = Date.now();
            this.ready = this.readyCount() === this.bridges.length;
            if (this.ready) {
                clearInterval(interval);
                console.log('Readiness checking is done...');
                if (Cmd.get('clean')) {
                    this.createCleanQueue();
                }
                if (this.payload) {
                    const queue = SipdCmd.get(this.payload.command)
                        .consume(this.payload.params || {});
                    const closeOnCompleteOrError = q => {
                        if (q.id === queue.id && (this.config.autoClose === undefined || this.config.autoClose)) {
                            process.exit();
                        }
                    }
                    this.dequeue
                        .on('queue-done', closeOnCompleteOrError)
                        .on('queue-error', closeOnCompleteOrError);
                }
            } else {
                if (now - this.startTime > readinessTimeout) {
                    throw new Error(util.format('Bridge is not ready within %d seconds timeout!', readinessTimeout / 1000));
                }
            }
        }, 1000);
        console.log('Readiness checking has been started...');
    }

    registerConsumers() {
        const { SipdBridgeConsumer, SipdCallbackConsumer, SipdCleanerConsumer } = SipdQueue.CONSUMERS;
        const consumers = [
            new SipdCleanerConsumer(10),
            new SipdCallbackConsumer(10),
        ];
        this.bridges.forEach(bridge => {
            consumers.push(new SipdBridgeConsumer(bridge, bridge.accepts ? 20 : 30));
        });
        this.dequeue.setConsumer(consumers);
    }

    handleConnection(socket) {
        console.log('Client connected: %s', socket.id);
        SipdCmd.handle(socket);
    }

    handleNotify() {
        let captcha = 0;
        if (typeof this.config.solver === 'function') {
            for (const bridge of this.bridges) {
                if (bridge.hasState('captcha')) {
                    captcha++;
                    if (!bridge.captchaSolving) {
                        bridge.captchaSolving = true;
                        const f = () => {
                            Work.works([
                                [w => bridge.saveCaptcha(this.config.tmpdirname)],
                                [w => this.config.solver(w.getRes(0), bridge.loginfo), w => w.getRes(0)],
                                [w => bridge.solveCaptcha(w.getRes(1)), w => w.getRes(1)],
                            ])
                            .then(res => {
                                if (res !== undefined && !res) {
                                    console.error(`Captcha code for ${bridge.name} is invalid, retrying...`);
                                    f();
                                } else {
                                    delete bridge.captchaSolving;
                                }
                            })
                            .catch(err => {
                                delete bridge.captchaSolving;
                                console.error(`An error occured while solving captcha: ${err}!`);
                            });
                        }
                        f();
                    }
                }
            }
        }
        if (captcha === 0) {
            this.sockets.forEach(socket => {
                socket.emit('status', this.dequeue.getStatus());
            });
        }
    }

    readyCount() {
        let readyCnt = 0;
        this.bridges.forEach(b => {
            if (b.isOperational()) {
                readyCnt++;
            }
        });
        return readyCnt;
    }

    getCaptcha() {
        const res = [];
        for (const bridge of this.bridges) {
            if (bridge.hasState('captcha')) {
                res.push(bridge.name);
            }
        }
        return res;
    }

    run() {
        if (this.initialize()) {
            const serve = this.processArguments();
            this.createDequeuer();
            this.createBridges();
            this.registerCommands();
            this.createServer(serve);
            return true;
        } else {
            usage();
        }
    }
}

module.exports = App;
