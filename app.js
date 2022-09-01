/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022 Toha <tohenk@yahoo.com>
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
const Work = require('@ntlab/work/work');
const SiapBridge = require('./bridge');
const SiapQueue = require('./queue');
const SiapNotifier = require('./notifier');

Cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set server port to listen', 'port');
Cmd.addVar('url', '', 'Set Siap url', 'url');
Cmd.addVar('profile', '', 'Use profile for operation', 'profile');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

class App {

    VERSION = 'SIAP-BRIDGE-1.0'

    config = {}
    bridges = []
    sockets = []
    uploads = {}
    sessions = {}

    initialize() {
        let filename, profile;
        // read configuration from command line values
        filename = Cmd.get('config') ? Cmd.get('config') : path.join(__dirname, 'config.json');
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
        if (Cmd.get('url')) this.config.url = Cmd.get('url');
        if (!this.config.workdir) this.config.workdir = __dirname;
        // load form maps
        filename = path.join(__dirname, 'maps.json');
        if (fs.existsSync(filename)) {
            this.config.maps = JSON.parse(fs.readFileSync(filename));
            console.log('Maps loaded from %s', filename);
        }
        // load roles
        filename = path.join(__dirname, 'roles.json');
        if (fs.existsSync(filename)) {
            this.config.roles = JSON.parse(fs.readFileSync(filename));
            console.log('Roles loaded from %s', filename);
        }
        // load profile
        this.config.profiles = {};
        filename = path.join(__dirname, 'profiles.json');
        if (fs.existsSync(filename)) {
            const profiles = JSON.parse(fs.readFileSync(filename));
            if (profiles.profiles) this.config.profiles = profiles.profiles;
            if (profiles.active) profile = profiles.active;
        }
        if (Cmd.get('profile')) profile = Cmd.get('profile');
        if (profile && this.config.profiles[profile]) {
            console.log('Using profile %s', profile);
            const keys = ['timeout', 'wait', 'delay', 'opdelay'];
            for (let key in this.config.profiles[profile]) {
                if (keys.indexOf(key) < 0) continue;
                this.config[key] = this.config.profiles[profile][key];
            }
        }
        // add default bridges
        if (!this.configs) {
            this.configs = {yr: {year: new Date().getFullYear()}};
        }
        return true;
    }

    createDequeuer() {
        this.dequeue = SiapQueue.createDequeuer();
        this.dequeue.setInfo({version: this.VERSION, ready: () => this.ready ? 'Yes' : 'No'});
        this.dequeue
            .on('queue', queue => this.handleNotify(queue))
            .on('queue-done', queue => this.handleNotify(queue))
            .on('queue-error', queue => this.handleNotify(queue))
        ;
    }

    createBridges() {
        Object.keys(this.configs).forEach(name => {
            let options = this.configs[name];
            let config = Object.assign({}, this.config, options);
            let browser = config.browser ? config.browser : 'default';
            if (browser) {
                if (!this.sessions[browser]) this.sessions[browser] = 0;
                this.sessions[browser]++;
                if (this.sessions[browser] > 1) config.session = 's' + this.sessions[browser];
            }
            let bridge = new SiapBridge(config);
            bridge.name = name;
            bridge.year = config.year;
            this.bridges.push(bridge);
            console.log('Siap bridge created: %s', name);
        });
    }

    createServer() {
        const { createServer } = require('http');
        const http = createServer();
        const port = Cmd.get('port') | 4000;
        const opts = {};
        if (this.config.cors) {
            opts.cors = this.config.cors;
        } else {
            opts.cors = {origin: '*'};
        }
        const { Server } = require('socket.io');
        const io = new Server(http, opts);
        io.of('/siap')
            .on('connection', socket => {
                this.handleConnection(socket);
            })
        ;
        http.listen(port, () => {
            console.log('Application ready on port %s...', port);
            const selfTests = [];
            this.bridges.forEach(bridge => {
                selfTests.push(w => bridge.selfTest());
            });
            Work.works(selfTests)
                .then(() => {
                    this.dequeue.setConsumer(this);
                    console.log('Queue processing is ready...');
                })
                .catch(err => console.log(err))
            ;
            this.checkReadiness();
        });
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
        socket
            .on('disconnect', () => {
                console.log('Client disconnected: %s', socket.id);
                const idx = this.sockets.indexOf(socket);
                if (idx >= 0) {
                    this.sockets.splice(idx);
                }
            })
            .on('notify', () => {
                if (this.sockets.indexOf(socket) < 0) {
                    this.sockets.push(socket);
                    console.log('Client notification enabled: %s', socket.id);
                }
            })
            .on('status', () => {
                socket.emit('status', this.dequeue.getStatus());
            })
            .on('setup', data => {
                if (data.callback) {
                    socket.callback = data.callback;
                }
                socket.emit('setup', {version: this.VERSION});
            })
            .on('spp', data => {
                const batch = Array.isArray(data.items);
                const items = batch ? data.items : [data];
                let result;
                let cnt = 0;
                items.forEach(spp => {
                    const queue = SiapQueue.createSppQueue(spp, socket.callback);
                    queue.maps = this.config.maps;
                    queue.info = queue.getMappedData('info.title');
                    console.log('SPP: %s', queue.info ? queue.info : '');
                    const res = SiapQueue.addQueue(queue);
                    cnt++;
                    if (!batch) {
                        result = res;
                    }
                });
                if (batch) {
                    result = {count: cnt, message: 'SPP is being queued'};
                }
                socket.emit('spp', result);
            })
        ;
    }

    handleNotify() {
        this.sockets.forEach(socket => {
            socket.emit('status', this.dequeue.getStatus());
        });
    }

    getQueueHandler(queue) {
        let bridge;
        const year = queue.data && queue.data.year ? queue.data.year : null;
        // get prioritized bridge based on accepts type
        this.bridges.forEach(b => {
            if (b.isOperational() && b.year == year && Array.isArray(b.accepts) && b.accepts.indexOf(queue.type) >= 0) {
                bridge = b;
                return true;
            }
        });
        // fallback to default bridge
        if (!bridge) {
            this.bridges.forEach(b => {
                if (b.isOperational() && b.year == year && b.accepts == undefined) {
                    bridge = b;
                    return true;
                }
            });
        }
        return bridge;
    }

    readyCount() {
        let readyCnt = 0;
        this.bridges.forEach(b => {
            if (b.isOperational()) readyCnt++;
        });
        return readyCnt;
    }

    processQueue(queue) {
        if (queue.type == SiapQueue.QUEUE_CALLBACK) {
            return SiapNotifier.notify(queue);
        }
        const bridge = this.getQueueHandler(queue);
        if (bridge) {
            bridge.queue = queue;
            queue.bridge = bridge;
            queue.ontimeout = () => bridge.siap.stop();
            switch (queue.type) {
                case SiapQueue.QUEUE_SPP:
                    return bridge.createSpp(queue);
            }
        }
        return Promise.reject(util.format('No bridge can handle %s!', queue.getInfo()));
    }

    run() {
        if (this.initialize()) {
            this.createDequeuer();
            this.createBridges();
            this.createServer();
            return true;
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