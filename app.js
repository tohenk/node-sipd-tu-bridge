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
const Cmd = require('@ntlab/ntlib/cmd');

Cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
Cmd.addVar('mode', 'm', 'Set bridge mode, spp or util', 'bridge-mode');
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set server port to listen', 'port');
Cmd.addVar('url', '', 'Set Sipd url', 'url');
Cmd.addVar('profile', '', 'Use profile for operation', 'profile');
Cmd.addBool('clean', '', 'Clean profile directory');
Cmd.addBool('queue', 'q', 'Enable queue saving and loading');
Cmd.addBool('noop', '', 'Do not process queue');
Cmd.addVar('count', '', 'Set count of operation such as captcha fetching', 'number');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

const fs = require('fs');
const util = require('util');
const Work = require('@ntlab/work/work');
const SipdCmd = require('./cmd');
const SipdNotifier = require('./notifier');
const SipdQueue = require('./queue');
const SipdBridge = require('./bridge');
const SipdSppBridge = require('./bridge/spp');
const SipdUtilBridge = require('./bridge/util');
const debug = require('debug')('sipd:main');
const { Socket } = require('socket.io');

class App {

    VERSION = 'SIPD-BRIDGE-3.0'

    BRIDGE_SPP = 'spp'
    BRIDGE_UTIL = 'util'

    config = {}
    /** @type {SipdBridge[]} */
    bridges = []
    /** @type {Socket[]} */
    sockets = []
    sessions = {}

    initialize() {
        // read configuration from command line values
        let profile, filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
        if (fs.existsSync(filename)) {
            const config = JSON.parse(fs.readFileSync(filename));
            if (config.global) {
                this.config = config.global;
                this.configs = config.bridges;
            } else {
                this.config = config;
            }
        }
        for (const c of ['mode', 'url']) {
            if (Cmd.get(c)) {
                this.config[c] = Cmd.get(c);
            }
        }
        if (!this.config.mode) {
            return false;
        }
        if (!this.config.workdir) {
            this.config.workdir = __dirname;
        }
        if (fs.existsSync(filename)) {
            console.log('Configuration loaded from %s', filename);
        }
        // load roles
        filename = path.join(__dirname, 'roles.json');
        if (fs.existsSync(filename)) {
            this.config.roles = JSON.parse(fs.readFileSync(filename));
            console.log('Roles loaded from %s', filename);
        }
        // load bridge specific configuration
        switch (this.config.mode) {
            case this.BRIDGE_SPP:
                // load form maps
                filename = path.join(__dirname, 'maps.json');
                if (fs.existsSync(filename)) {
                    this.config.maps = JSON.parse(fs.readFileSync(filename));
                    console.log('Maps loaded from %s', filename);
                }
                // add default bridges
                if (!this.configs) {
                    const year = new Date().getFullYear();
                    this.configs = {[`sipd-${year}`]: {year}};
                }
                break;
        }
        // load profile
        this.config.profiles = {};
        filename = path.join(__dirname, 'profiles.json');
        if (fs.existsSync(filename)) {
            const profiles = JSON.parse(fs.readFileSync(filename));
            if (profiles.profiles) {
                this.config.profiles = profiles.profiles;
            }
            if (profiles.active) {
                profile = profiles.active;
            }
        }
        if (Cmd.get('profile')) {
            profile = Cmd.get('profile');
        }
        if (profile && this.config.profiles[profile]) {
            console.log('Using profile %s', profile);
            const keys = ['timeout', 'wait', 'delay', 'opdelay'];
            for (const key in this.config.profiles[profile]) {
                if (keys.indexOf(key) < 0) {
                    continue;
                }
                this.config[key] = this.config.profiles[profile][key];
            }
        }
        // clean profile
        if (Cmd.get('clean')) {
            const profiledir = path.join(this.config.workdir, 'profile');
            if (fs.existsSync(profiledir)) {
                fs.rmSync(profiledir, {recursive: true, force: true});
            }
        }
        // captcha solver
        if (this.config['captcha-solver']) {
            // {
            //     "global": {
            //         "captcha-solver": {
            //             "bin": "python",
            //             "args": ["/path/to/solver.py", "%CAPTCHA%"]
            //         }
            //     }
            // }
            const cmd = require('@ntlab/ntlib/command')(this.config['captcha-solver'], {});
            this.solver = captcha => {
                if (captcha) {
                    return new Promise((resolve, reject) => {
                        let stdout, stderr;
                        const p = cmd.exec({CAPTCHA: captcha});
                        p.stdout.on('data', line => {
                            if (stdout === undefined) {
                                stdout = line;
                            } else {
                                stdout = Buffer.concat([stdout, line]);
                            }
                        });
                        p.stderr.on('data', line => {
                            if (stderr === undefined) {
                                stderr = line;
                            } else {
                                stderr = Buffer.concat([stderr, line]);
                            }
                        });
                        p.on('exit', code => {
                            fs.rmSync(captcha);
                            resolve({code, stdout, stderr});
                        });
                        p.on('error', err => {
                            reject(err);
                        });
                    });
                }
                return Promise.resolve();
            }
            this.config.getPath = function(path) {
                let rootPath = this.rootPath;
                if (rootPath) {
                    if (rootPath.substr(-1) === '/') {
                        rootPath = rootPath.substr(0, rootPath.length - 1);
                    }
                    if (rootPath) {
                        path = rootPath + path;
                    }
                }
                return path;
            }
        }
        return true;
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
                    queue.maps = this.config.maps;
                    queue.info = queue.getMappedData('info.title');
                    queue.retry = true;
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
        const bridges = Object.keys(this.configs);
        let seq = 0;
        bridges.forEach(name => {
            const id = `bridge${++seq}`;
            const options = this.configs[name];
            const config = Object.assign({}, this.config, options);
            if (config.enabled !== undefined && !config.enabled) {
                return true;
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
                case this.BRIDGE_SPP:
                    bridge = new SipdSppBridge(config);
                    break;
                case this.BRIDGE_UTIL:
                    bridge = new SipdUtilBridge(config);
                    break;
            }
            if (bridge) {
                bridge.name = name;
                bridge.year = config.year;
                bridge.onState = () => this.handleNotify();
                this.bridges.push(bridge);
                console.log('Sipd bridge created: %s', name);
            }
        });
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
            io.of('/sipd')
                .on('connection', socket => {
                    this.handleConnection(socket);
                })
            ;
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
                        this.dequeue.setConsumer(this);
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
        const prefixes = {[this.BRIDGE_SPP]: 'spp', [this.BRIDGE_UTIL]: 'util'};
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

    handleConnection(socket) {
        console.log('Client connected: %s', socket.id);
        SipdCmd.handle(socket);
    }

    handleNotify() {
        let captcha = 0;
        if (typeof this.solver === 'function') {
            for (const bridge of this.bridges) {
                if (bridge.hasState('captcha')) {
                    captcha++;
                    Work.works([
                        [w => bridge.saveCaptcha('tmp')],
                        [w => this.solver(w.getRes(0))],
                        [w => new Promise((resolve, reject) => {
                            const res = w.getRes(1);
                            if (typeof res === 'object' && res.stdout) {
                                const code = res.stdout.toString().trim();
                                if (code) {
                                    bridge.solveCaptcha(code);
                                }
                            }
                            resolve();
                        })],
                    ]);
                }
            }
        }
        if (captcha === 0) {
            this.sockets.forEach(socket => {
                socket.emit('status', this.dequeue.getStatus());
            });
        }
    }

    isBridgeReady(bridge) {
        // bridge currently has no queue
        // or the last queue has been finished
        if (bridge && (bridge.queue === undefined || bridge.queue.finished())) {
            return true;
        }
        return false;
    }

    getQueueHandler(queue, ready = true) {
        const bridges = [];
        const year = queue.data && queue.data.year ? queue.data.year : null;
        // get prioritized bridge based on accepts type
        this.bridges.forEach(b => {
            if (b.isOperational() && b.year == year && Array.isArray(b.accepts) && b.accepts.indexOf(queue.type) >= 0) {
                if (!ready || this.isBridgeReady(b)) {
                    bridges.push(b);
                }
            }
        });
        // fallback to default bridge
        if (!bridges.length) {
            this.bridges.forEach(b => {
                if (b.isOperational() && b.year == year && b.accepts === undefined) {
                    if (!ready || this.isBridgeReady(b)) {
                        bridges.push(b);
                    }
                }
            });
        }
        return bridges;
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

    isBridgeIdle(queue) {
        const handlers = this.getQueueHandler(queue, false);
        if (handlers.length === 0) {
            debug('No handler', queue);
            queue.setStatus(SipdQueue.STATUS_SKIPPED);
        }
        const bridges = handlers.filter(b => this.isBridgeReady(b));
        return bridges.length ? true : false;
    }

    canProcessQueue() {
        if (this.readyCount() > 0) {
            const queue = this.dequeue.getNext();
            if (queue) {
                if (!queue.logged) {
                    debug('Next queue', queue);
                    queue.logged = true;
                }
            }
            return queue && (
                queue.type === SipdQueue.QUEUE_CALLBACK ||
                queue.status === SipdQueue.STATUS_SKIPPED ||
                this.isBridgeIdle(queue));
        }
        return false;
    }

    canHandleNextQueue(queue) {
        return this.isBridgeIdle(queue);
    }

    processQueue(queue) {
        if (queue.type === SipdQueue.QUEUE_CALLBACK) {
            return SipdNotifier.notify(queue);
        }
        /** @type {SipdBridge} */
        let bridge = queue.bridge;
        if (!bridge) {
            const bridges = this.getQueueHandler(queue);
            if (bridges.length) {
                bridge = bridges[Math.floor(Math.random() * bridges.length)];
                bridge.queue = queue;
                queue.bridge = bridge;
                queue.onretry = () => bridge.end();
                queue.ontimeout = () => bridge.end();
            }
        }
        if (bridge) {
            switch (queue.type) {
                case SipdQueue.QUEUE_SPP:
                    return bridge.createSpp(queue);
                case SipdQueue.QUEUE_CAPTCHA:
                    return bridge.fetchCaptcha(queue);
                case SipdQueue.QUEUE_NOOP:
                    return bridge.noop();
            }
        }
        return Promise.reject(util.format('No bridge can handle %s!', queue.getInfo()));
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
                case this.BRIDGE_UTIL:
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
                            if (q.id === queue.id) {
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

(function run() {
    new App().run();
})();

function usage() {
    console.log('Usage:');
    console.log('  node %s [options]', path.basename(process.argv[1]));
    console.log('');
    console.log('Options:');
    console.log(Cmd.dump());
    console.log('');
    return true;
}