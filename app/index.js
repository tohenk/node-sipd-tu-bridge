/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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
        this.dequeue.createQueue = data => {
            let queue;
            switch (data.type) {
                case SipdQueue.QUEUE_SPP:
                    queue = SipdQueue.createSppQueue(data.data, data.callback);
                    this.dequeue.setMaps(queue);
                    queue.retry = true;
                    break;
                case SipdQueue.QUEUE_SPP_QUERY:
                    queue = SipdQueue.createSppQueryQueue(data.data, data.callback);
                    this.dequeue.setMaps(queue);
                    queue.readonly = true;
                    break;
                case SipdQueue.QUEUE_CAPTCHA:
                    queue = SipdQueue.createCaptchaQueue(data.data);
                    queue.info = null;
                    break;
                case SipdQueue.QUEUE_NOOP:
                    queue = SipdQueue.createNoopQueue(data.data);
                    queue.info = null;
                    break;
            }
            if (queue) {
                if (data.id) {
                    queue.id = data.id;
                }
                if (queue.type === SipdQueue.QUEUE_SPP && SipdQueue.hasPendingQueue(queue)) {
                    return {message: `SPP ${queue.info} sudah dalam antrian!`};
                }
                console.log('%s: %s', queue.type.toUpperCase(), queue.info);
                return SipdQueue.addQueue(queue);
            }
        }
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
                config.profiledir = path.join(this.config.workdir, 'profile', id);
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

    registerCommands() {
        const prefixes = {[Configuration.BRIDGE_SPP]: 'spp', [Configuration.BRIDGE_UTIL]: 'util'};
        SipdCmd.register(this, prefixes[this.config.mode]);
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
            } else {
                if (now - this.startTime > readinessTimeout) {
                    throw new Error(util.format('Bridge is not ready within %d seconds timeout!', readinessTimeout / 1000));
                }
            }
        }, 1000);
        console.log('Readiness checking has been started...');
    }

    registerConsumers() {
        const { SipdBridgeConsumer, SipdCallbackConsumer } = SipdQueue.CONSUMERS;
        const consumers = [new SipdCallbackConsumer(10)];
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
                                [w => bridge.saveCaptcha('tmp')],
                                [w => this.config.solver(w.getRes(0), {tag: bridge.name}), w => w.getRes(0)],
                                [w => bridge.solveCaptcha(w.getRes(1)), w => w.getRes(1)],
                            ])
                            .then(res => {
                                if (!res) {
                                    console.error(`Captcha code is invalid, retrying...`);
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
            this.createDequeuer();
            this.createBridges();
            this.registerCommands();
            let cmd, serve = true;
            if (Cmd.args.length) {
                cmd = Cmd.args.shift();
            }
            switch (this.config.mode) {
                case Configuration.BRIDGE_UTIL:
                    serve = false;
                    let command, data;
                    switch (cmd) {
                        case 'captcha':
                            command = 'util:captcha';
                            data = {
                                year: new Date().getFullYear(),
                                count: Cmd.get('count') ? parseInt(Cmd.get('count')) : 10,
                                timeout: 0,
                            }
                            break;
                        case 'noop':
                            command = 'util:noop';
                            data = {
                                year: new Date().getFullYear(),
                                timeout: 0,
                            }
                            break;
                    }
                    if (command) {
                        const queue = SipdCmd.get(command).consume({data: data ? data : {}});
                        this.dequeue.on('queue-done', q => {
                            if (q.id === queue.id && (this.config.autoClose === undefined || this.config.autoClose)) {
                                process.exit();
                            }
                        });
                    } else {
                        console.log('Supported utility: captcha, noop');
                        process.exit();
                    }
                    break;
            }
            this.createServer(serve);
            return true;
        } else {
            usage();
        }
    }
}

module.exports = App;
