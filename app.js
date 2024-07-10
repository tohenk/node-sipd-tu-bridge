/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2024 Toha <tohenk@yahoo.com>
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
Cmd.addVar('mode', 'm', 'Set bridge mode, spp or captcha', 'bridge-mode');
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set server port to listen', 'port');
Cmd.addVar('url', '', 'Set Siap url', 'url');
Cmd.addVar('profile', '', 'Use profile for operation', 'profile');
Cmd.addBool('clean', '', 'Clean profile directory');
Cmd.addBool('queue', 'q', 'Enable queue saving and loading');
Cmd.addBool('noop', '', 'Do not process queue');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

const fs = require('fs');
const util = require('util');
const Work = require('@ntlab/work/work');
const SiapCmd = require('./cmd');
const SiapSppBridge = require('./bridge/spp');
const SiapQueue = require('./queue');
const SiapNotifier = require('./notifier');

class App {

    VERSION = 'SIAP-BRIDGE-3.0'

    BRIDGE_SPP = 'spp'

    config = {}
    bridges = []
    sockets = []
    uploads = {}
    sessions = {}

    initialize() {
        // read configuration from command line values
        let profile, filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
        if (fs.existsSync(filename)) {
            console.log('Reading configuration %s', filename);
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
        if (!this.config.workdir) {
            this.config.workdir = __dirname;
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
                    this.configs = {[`siap-${year}`]: {year}};
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
        return true;
    }

    createDequeuer() {
        this.dequeue = SiapQueue.createDequeuer();
        this.dequeue.setInfo({
            version: this.VERSION,
            ready: () => this.ready ? 'Yes' : 'No',
            captcha: () => this.getCaptcha(),
        });
        this.dequeue.createQueue = data => {
            let queue;
            switch (data.type) {
                case SiapQueue.QUEUE_SPP:
                    queue = SiapQueue.createSppQueue(data.data, data.callback);
                    queue.maps = this.config.maps;
                    queue.info = queue.getMappedData('info.title');
                    break;
            }
            if (queue) {
                if (data.id) {
                    queue.id = data.id;
                }
                if (queue.type === SiapQueue.QUEUE_SPP && SiapQueue.hasPendingQueue(queue)) {
                    return {message: `SPP ${queue.info} sudah dalam antrian!`};
                }
                console.log('%s: %s', queue.type.toUpperCase(), queue.info);
                return SiapQueue.addQueue(queue);
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
        Object.keys(this.configs).forEach(name => {
            const options = this.configs[name];
            const config = Object.assign({}, this.config, options);
            if (config.enabled !== undefined && !config.enabled) {
                return true;
            }
            const browser = config.browser ? config.browser : 'default';
            if (browser) {
                if (!this.sessions[browser]) {
                    this.sessions[browser] = 0;
                }
                this.sessions[browser]++;
                if (this.sessions[browser] > 1) {
                    config.session = 's' + this.sessions[browser];
                }
            }
            let bridge;
            switch (this.config.mode) {
                case this.BRIDGE_SPP:
                    bridge = new SiapSppBridge(config);
                    break;
            }
            if (bridge) {
                bridge.name = name;
                bridge.year = config.year;
                bridge.onState = () => this.handleNotify();
                this.bridges.push(bridge);
                console.log('Siap bridge created: %s', name);
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
            if (this.config.cors) {
                opts.cors = this.config.cors;
            } else {
                opts.cors = {origin: '*'};
            }
            const io = new Server(http, opts);
            io.of('/siap')
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
                        this.dequeue.setConsumer(this);
                        console.log('Queue processing is ready...');
                    }
                })
                .catch(err => console.error(err))
            ;
            this.checkReadiness();
        });
    }

    registerCommands() {
        const prefixes = {[this.BRIDGE_SPP]: 'spp'};
        SiapCmd.register(this, prefixes[this.config.mode]);
    }

    checkReadiness() {
        const readinessTimeout = this.config.readinessTimeout || 30000; // 30 seconds
        this.startTime = Date.now();
        let interval = setInterval(() => {
            let now = Date.now();
            this.ready = this.readyCount() == this.bridges.length;
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
        SiapCmd.handle(socket);
    }

    handleNotify() {
        this.sockets.forEach(socket => {
            socket.emit('status', this.dequeue.getStatus());
        });
    }

    isBridgeReady(bridge) {
        // bridge currently has no queue
        // or the last queue has been finished
        if (bridge && (bridge.queue === undefined || bridge.queue.finished())) {
            return true;
        }
        return false;
    }

    getQueueHandler(queue) {
        const bridges = [];
        const year = queue.data && queue.data.year ? queue.data.year : null;
        // get prioritized bridge based on accepts type
        this.bridges.forEach(b => {
            if (b.isOperational() && b.year == year && Array.isArray(b.accepts) && b.accepts.indexOf(queue.type) >= 0) {
                if (this.isBridgeReady(b)) {
                    bridges.push(b);
                }
            }
        });
        // fallback to default bridge
        if (!bridges.length) {
            this.bridges.forEach(b => {
                if (b.isOperational() && b.year == year && b.accepts === undefined) {
                    if (this.isBridgeReady(b)) {
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
            if (b.isOperational()) readyCnt++;
        });
        return readyCnt;
    }

    isBridgeIdle(queue) {
        const bridges = this.getQueueHandler(queue);
        return bridges.length ? true : false;
    }

    canProcessQueue() {
        if (this.readyCount() > 0) {
            const queue = this.dequeue.getNext();
            return queue && (queue.type == SiapQueue.QUEUE_CALLBACK || this.isBridgeIdle(queue));
        }
        return false;
    }

    canHandleNextQueue(queue) {
        return this.isBridgeIdle(queue);
    }

    processQueue(queue) {
        if (queue.type == SiapQueue.QUEUE_CALLBACK) {
            return SiapNotifier.notify(queue);
        }
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
                case SiapQueue.QUEUE_SPP:
                    return bridge.createSpp(queue);
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
            this.createServer();
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