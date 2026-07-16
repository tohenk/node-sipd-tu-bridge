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

const fs = require('fs');
const path = require('path');
const util = require('util');
const Cmd = require('@ntlab/ntlib/cmd');
const Api = require('./api');
const CaptchaSolver = require('./solver');
const Configuration = require('./configuration');
const SipdBridgeCommon = require('./bridge/common');
const SipdBridgeRekanan = require('./bridge/rekanan');
const SipdBridgeLpj = require('./bridge/lpj');
const SipdBridgeSpp = require('./bridge/spp');
const SipdBridgeUtil = require('./bridge/util');
const SipdCmd = require('./cmd');
const SipdLogger = require('./sipd/logger');
const SipdQueue = require('./queue');
const SipdUtil = require('./sipd/util');
const Queue = require('@ntlab/work/queue');
const Work = require('@ntlab/work/work');
const { SipdBridge } = require('./bridge');
const { Socket } = require('socket.io');

const dtag = 'app';

/**
 * Main application entry point.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class App {

    VERSION = 'SIPD-BRIDGE-4.2'

    PRIO_FIRST = 10
    PRIO_ABOVE = 20
    PRIO_NORMAL = 30

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

    /**
     * Do initialization.
     *
     * @returns {boolean}
     */
    initialize() {
        this
            .initializeConfiguration()
            .initializeLogger()
            .initializeSolver();
        return this.config.initialized;
    }

    /**
     * Initialize application configuration.
     *
     * @returns {this}
     */
    initializeConfiguration() {
        this.config = new Configuration(this.rootDir);
        this.config
            .applyServerKeys()
            .applyProfile();
        return this;
    }

    /**
     * Initialize application logger.
     *
     * @returns {this}
     */
    initializeLogger() {
        SipdLogger.onLogs = (tag, logs) => {
            if (this.api) {
                if (tag === SipdLogger.LOG_ACTIVITY) {
                    this.api.notify('activity', {time: Date.now(), logs});
                } else {
                    const bridge = this.bridges.find(b => b.name === tag);
                    if (bridge) {
                        this.api.notify('log', {bridge: bridge.name, time: Date.now(), logs});
                    }
                }
            }
        }
        return this;
    }

    /**
     * Initialize Captcha Solver.
     *
     * @returns {this}
     */
    initializeSolver() {
        this.solver = CaptchaSolver.create(this.config.captchaSolver);
        return this;
    }

    /**
     * Create queue processor (aka. dequeuer).
     */
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
                    res = {message: `A queue for ${queue.id} is already exist or being processed!`};
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
            if (!queue.mode) {
                throw new Error('Unable to set maps on queue without mode!');
            }
            if (this.config.maps[queue.mode] === undefined) {
                throw new Error(`Queue map ${queue.mode} is not loaded!`);
            }
            queue.maps = this.config.maps[queue.mode];
            queue.info = queue.getMappedData('info.title');
        }
        this.dequeue
            .on('queue', q => this.handleNotify(q))
            .on('queue-done', q => this.handleNotify(q))
            .on('queue-error', q => this.handleNotify(q))
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

    /**
     * Create bridges for queue processing.
     */
    createBridges() {
        let seq = 0;
        for (const [name, options] of Object.entries(this.config.bridges)) {
            const id = `bridge${++seq}`;
            const config = Object.assign({}, this.config, options);
            if (config.enabled !== undefined && !config.enabled) {
                continue;
            }
            const browser = config.browser ?? 'default';
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
            const bridge = new SipdBridge(name, config);
            bridge.year = config.year;
            bridge.onState = () => this.handleNotify();
            for (const mode of ['*', Configuration.BRIDGE_LPJ, Configuration.BRIDGE_SPP, Configuration.BRIDGE_UTIL]) {
                if (mode !== '*' && this.config.mode && this.config.mode !== mode) {
                    continue;
                }
                switch (mode) {
                    case '*':
                        bridge
                            .addHandler(SipdBridgeCommon)
                            .addHandler(SipdBridgeRekanan);
                        break;
                    case Configuration.BRIDGE_SPP:
                        bridge.addHandler(SipdBridgeSpp);
                        break;
                    case Configuration.BRIDGE_LPJ:
                        bridge.addHandler(SipdBridgeLpj);
                        break;
                    case Configuration.BRIDGE_UTIL:
                        bridge.addHandler(SipdBridgeUtil);
                        break;
                }
            }
            this.bridges.push(bridge);
            console.log('Sipd bridge created: %s', name);
        }
    }

    /**
     * Create web interface.
     */
    createUI() {
        if (this.config.ui && this.bridges.length) {
            try {
                const factory = require(this.config.ui);
                this.api = new Api(this);
                this.ui = factory(this.api);
            } catch (err) {
                console.error(`Web interface not available: ${this.config.ui}!`);
                if (err instanceof Error) {
                    console.error(err.stack);
                } else {
                    console.error(err);
                }
            }
        }
    }

    /**
     * Create HTTP server.
     *
     * @param {boolean} serve True to handle socket.io connection
     */
    createServer(serve = true) {
        const { createServer } = require('http');
        const { Server } = require('socket.io');
        const http = createServer(this.ui ?? {});
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
                });
            if (this.config.token) {
                ns.use((socket, next) => {
                    const auth = socket.handshake.headers.authorization;
                    if (auth) {
                        const token = auth.replace('Bearer ', '');
                        if (token === this.config.token) {
                            return next();
                        }
                    }
                    SipdLogger.activity(dtag)('Client %s is using invalid authorization', socket.id);
                    next(new Error('Invalid authorization'));
                });
            }
            if (this.ui) {
                io.of('/ui')
                    .on('connection', socket => {
                        this.handleUIConnection(socket);
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
                });
            this.checkReadiness();
        });
    }

    /**
     * Create profile directory clean queue.
     *
     * @returns {object}
     */
    createCleanQueue() {
        return this.dequeue.createQueue({type: SipdQueue.QUEUE_CLEAN, data: {dir: this.config.profiledir}});
    }

    /**
     * Register bridge command handler.
     */
    registerCommands() {
        const prefixes = {
            [Configuration.BRIDGE_LPJ]: 'lpj',
            [Configuration.BRIDGE_SPP]: 'spp',
            [Configuration.BRIDGE_UTIL]: 'util',
        }
        SipdCmd.setApp(this).register();
        for (const [mode, prefix] of Object.entries(prefixes)) {
            if (this.config.mode && this.config.mode !== mode) {
                continue;
            }
            SipdCmd
                .register(mode, prefix, prefix, true)
                .register(mode, prefix, 'all', true);
        }
    }

    /**
     * Process command line arguments.
     *
     * @returns {boolean} Wheter should activate socket.io server
     */
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

    /**
     * Do SPP operation.
     *
     * @param  {...any} args Arguments
     * @returns {Array}
     */
    doSppOp(...args) {
        let command = 'spp:query', data = {}, opts = {}, error;
        if (args.length === 2) {
            const queue = SipdQueue.createWithMap(this.config.maps[Configuration.BRIDGE_SPP]);
            data[queue.getMap('info.role')] = args[0];
            data[queue.getMap('info.check')] = args[1];
            opts.outdir = this.config.outdir;
        } else {
            error = 'SPP query requires KEG and SPP/SPM/SP2D number!';
        }
        return [false, command, data, opts, error];
    }

    /**
     * Do LPJ operation.
     *
     * @param  {...any} args Arguments
     */
    doLpjOp(...args) {
        let command = 'lpj:list', data = {}, opts = {}, error;
        if (args.length === 2) {
            const queue = SipdQueue.createWithMap(this.config.maps[Configuration.BRIDGE_LPJ]);
            data[queue.getMap('info.role')] = args[0];
            const date = args[1].split('~');
            if (date.length === 2) {
                data['LPJ_START'] = SipdUtil.getDate(date[0]);
                data['LPJ_END'] = SipdUtil.getDate(date[1]);
                opts.outdir = this.config.outdir;
            } else {
                error = 'Date range required, eg. 2026-01-01~2026-01-31!';
            }
        } else {
            error = 'LPJ list requires KEG and date range (delimited by ~)!';
        }
        return [false, command, data, opts, error];
    }

    /**
     * Do UTIL operation.
     *
     * @param  {...any} args Arguments
     * @returns {Array}
     */
    doUtilOp(...args) {
        let data = {}, opts = {}, error;
        const command = args.shift();
        switch (command) {
            case 'captcha':
                data.count = Cmd.get('count') ? parseInt(Cmd.get('count')) : 10;
                break;
            case 'noop':
                break;
            case 'rekanan':
                if (args.length) {
                    const queue = SipdQueue.createWithMap(this.config.maps[Configuration.BRIDGE_UTIL]);
                    data[queue.getMap('info.jenis')] = 'orang';
                    data[queue.getMap('info.role')] = args[0];
                    if (args.length > 1) {
                        data[queue.getMap('info.nik')] = args[1];
                    }
                    opts.outdir = this.config.outdir;
                } else {
                    error = 'Partner utility requires KEG and an optional NIK!';
                }
                break;
            default:
                error = 'Supported utility: captcha, noop, rekanan!';
                break;
        }
        return [false, `util:${command}`, data, opts, error];
    }

    /**
     * Perform bridge readiness check.
     */
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
                            setTimeout(() => process.exit(), 5000);
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

    /**
     * Register queue consumers.
     */
    registerConsumers() {
        const { SipdBridgeConsumer, SipdCallbackConsumer, SipdCleanerConsumer } = SipdQueue.CONSUMERS;
        const consumers = [
            new SipdCleanerConsumer(this.PRIO_FIRST),
            new SipdCallbackConsumer(this.PRIO_FIRST),
        ];
        this.bridges.forEach(bridge => {
            consumers.push(new SipdBridgeConsumer(bridge, bridge.accepts ? this.PRIO_ABOVE : this.PRIO_NORMAL));
        });
        this.dequeue.setConsumer(consumers);
    }

    /**
     * Handle client connection.
     *
     * @param {Socket} socket Client socket
     */
    handleConnection(socket) {
        console.log('Client connected: %s', socket.id);
        SipdCmd.handle(socket);
    }

    /**
     * Handle UI client connection.
     *
     * @param {Socket} socket Client connection
     */
    handleUIConnection(socket) {
        this.api.handle(socket);
    }

    /**
     * Handle bridge notification.
     *
     * @param {SipdQueue} queue Queue
     */
    handleNotify(queue) {
        let captcha = 0;
        if (typeof this.solver === 'function') {
            for (const bridge of this.bridges) {
                if (bridge.hasState('captcha')) {
                    captcha++;
                    if (!bridge.captchaSolving) {
                        bridge.captchaSolving = true;
                        bridge.works([
                            [w => bridge.getCaptcha()],
                            [w => new Promise((resolve, reject) => {
                                const captchas = Object.entries(w.getRes(0));
                                const q = new Queue(captchas, captcha => {
                                    const [sess, img] = captcha;
                                    const works = [
                                        ...this.solver(img, {dir: path.join(this.config.workdir, this.config.tmpdirname)}),
                                        [x => bridge.solveCaptcha(x.res, sess), x => x.res],
                                    ]
                                    bridge.works(works)
                                        .then(res => q.next())
                                        .catch(err => reject(err));
                                });
                                q.once('done', () => resolve());
                            }), w => Object.keys(w.getRes(0)).length],
                        ])
                        .then(() => {
                            delete bridge.captchaSolving;
                        })
                        .catch(err => {
                            delete bridge.captchaSolving;
                            console.error(`An error occured while solving captcha: ${err}!`);
                        });
                    }
                }
            }
        }
        if (captcha === 0) {
            for (const socket of this.sockets) {
                socket.emit('status', this.dequeue.getStatus());
            }
        }
        if (this.api && queue) {
            if (queue.status === SipdQueue.STATUS_ERROR) {
                this.api.notify('error');
            }
            this.api.notify('queue');
        }
    }

    /**
     * Get bridge ready count.
     *
     * @returns {number}
     */
    readyCount() {
        let readyCnt = 0;
        this.bridges.forEach(b => {
            if (b.isOperational()) {
                readyCnt++;
            }
        });
        return readyCnt;
    }

    /**
     * Get bridges which require captcha solving.
     *
     * @returns {string[]}
     */
    getCaptcha() {
        const res = [];
        for (const bridge of this.bridges) {
            if (bridge.hasState('captcha')) {
                res.push(bridge.name);
            }
        }
        return res;
    }

    /**
     * Run application.
     *
     * @returns {boolean|undefined}
     */
    run() {
        if (this.initialize()) {
            const serve = this.processArguments();
            this.createDequeuer();
            this.createBridges();
            this.registerCommands();
            if (serve) {
                this.createUI();
            }
            this.createServer(serve);
            return true;
        }
    }
}

module.exports = App;
