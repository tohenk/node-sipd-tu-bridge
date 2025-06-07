/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025 Toha <tohenk@yahoo.com>
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

const crypto = require('crypto');
const debug = require('debug')('sipd:config');
const fs = require('fs');
const path = require('path');
const Cmd = require('@ntlab/ntlib/cmd');
const SipdRole = require('../sipd/role');

Cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
Cmd.addVar('mode', 'm', 'Set bridge mode, spp or util', 'bridge-mode');
Cmd.addVar('config', 'c', 'Set configuration file', 'filename');
Cmd.addVar('port', 'p', 'Set server port to listen', 'port');
Cmd.addVar('url', '', 'Set Sipd url', 'url');
Cmd.addVar('profile', '', 'Use profile for operation', 'profile');
Cmd.addBool('clean', '', 'Clean profile directory');
Cmd.addBool('queue', 'q', 'Enable queue saving and loading');
Cmd.addBool('noop', '', 'Do not process queue');
Cmd.addVar('count', '', 'Limit number of operation such as when fetching captcha', 'number');

/**
 * Application configuration.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Configuration {

    /**
     * Constructor.
     *
     * @param {string} rootDir Configuration directory
     */
    constructor(rootDir) {
        // read configuration from command line values
        let filename = Cmd.get('config') ? Cmd.get('config') : path.join(rootDir, 'config.json');
        if (fs.existsSync(filename)) {
            let config = JSON.parse(fs.readFileSync(filename));
            if (config.global) {
                this.bridges = config.bridges;
                config = config.global;
            }
            Object.assign(this, config);
        }
        for (const c of ['mode', 'url']) {
            if (Cmd.get(c)) {
                this[c] = Cmd.get(c);
            }
        }
        if (fs.existsSync(filename)) {
            console.log('Configuration loaded from %s', filename);
        }
        if (!this.workdir) {
            this.workdir = rootDir;
        }
        if (this.mode) {
            this.initialize();
        }
    }

    initialize() {
        // load profile
        this.profiles = {};
        let filename = path.join(this.workdir, 'profiles.json');
        if (fs.existsSync(filename)) {
            const profiles = JSON.parse(fs.readFileSync(filename));
            if (profiles.profiles) {
                this.profiles = profiles.profiles;
            }
            if (profiles.active) {
                this.profile = profiles.active;
            }
        }
        // load form maps
        if (this.mode === Configuration.BRIDGE_SPP) {
            filename = path.join(this.workdir, 'maps.json');
            if (fs.existsSync(filename)) {
                this.maps = JSON.parse(fs.readFileSync(filename));
                console.log('Maps loaded from %s', filename);
            }
        }
        // load roles
        filename = path.join(this.workdir, 'roles.json');
        if (fs.existsSync(filename)) {
            this.roles = SipdRole
                .setFilename(filename)
                .load()
                .roles;
            console.log('Roles loaded from %s', filename);
        }
        // add default bridges
        if (this.mode === Configuration.BRIDGE_SPP && !this.bridges) {
            const year = new Date().getFullYear();
            this.bridges = {[`sipd-${year}`]: {year}};
        }
        this.initialized = true;
    }

    applyServerKeys() {
        if (this.privkey && fs.existsSync(this.privkey)) {
            this.privkey = crypto.createPrivateKey(fs.readFileSync(this.privkey));
        }
        if (this.pubkey && fs.existsSync(this.pubkey)) {
            this.pubkey = crypto.createPublicKey(fs.readFileSync(this.pubkey));
        }
        if (!this.privkey || !this.pubkey) {
            console.log('Generating end-to-end encryption key');
            const key = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
            this.privkey = key.privateKey;
            this.pubkey = key.publicKey;
        }
        return this;
    }

    applyProfile() {
        let profile = this.profile;
        if (null === profile && Cmd.get('profile')) {
            profile = Cmd.get('profile');
        }
        if (profile && this.profiles[profile]) {
            console.log('Using profile %s', profile);
            const keys = ['timeout', 'wait', 'delay', 'opdelay'];
            for (const key in this.profiles[profile]) {
                if (keys.indexOf(key) < 0) {
                    continue;
                }
                this[key] = this.profiles[profile][key];
            }
        }
        // clean profile
        if (Cmd.get('clean')) {
            const profiledir = path.join(this.workdir, 'profile');
            if (fs.existsSync(profiledir)) {
                fs.rmSync(profiledir, {recursive: true, force: true});
            }
        }
        return this;
    }

    applySolver() {
        // captcha solver
        if (this.captchaSolver) {
            // {
            //     "global": {
            //         "captchaSolver": {
            //             "bin": "python",
            //             "args": ["/path/to/solver.py", "%CAPTCHA%"]
            //         }
            //     }
            // }
            const cmd = require('@ntlab/ntlib/command')(this.captchaSolver, {});
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
                            const res = stdout.toString().trim();
                            debug('Resolved captcha', res);
                            resolve(res);
                        });
                        p.on('error', err => {
                            reject(err);
                        });
                    });
                }
                return Promise.resolve();
            }
        }
        return this;
    }

    getPath(path) {
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

    obfuscate(data, pubkey, padding = null) {
        if (data && pubkey) {
            padding = padding ?? crypto.constants.RSA_PKCS1_OAEP_PADDING;
            let blockSize = pubkey.asymmetricKeyDetails.modulusLength / 8;
            switch (padding) {
                case crypto.constants.RSA_PKCS1_PADDING:
                    blockSize -= 11;
                    break;
                case crypto.constants.RSA_PKCS1_OAEP_PADDING:
                    blockSize -= 42;
                    break;
            }
            const buff = Buffer.from(JSON.stringify(data));
            const parts = [];
            let pos = 0;
            while (true) {
                const part = buff.subarray(pos, pos + blockSize);
                if (!part.length) {
                    break;
                }
                parts.push(crypto.publicEncrypt(pubkey, part));
                pos += blockSize;
            }
            data = Buffer.concat(parts).toString('base64');
        }
        return data;
    }

    unobfuscate(data) {
        if (data && this.privkey) {
            const buff = Buffer.from(data, 'base64');
            if (buff.length) {
                const blockSize = this.privkey.asymmetricKeyDetails.modulusLength / 8;
                const parts = [];
                let pos = 0;
                while (true) {
                    const part = buff.subarray(pos, pos + blockSize);
                    if (!part.length) {
                        break;
                    }
                    parts.push(crypto.privateDecrypt(this.privkey, part));
                    pos += blockSize;
                }
                data = Buffer.concat(parts).toString();
            }
        }
        return data;
    }

    updateRoles(roles) {
        SipdRole.update(roles);
        return SipdRole.saved;
    }

    static get BRIDGE_SPP() { return 'spp' }
    static get BRIDGE_UTIL() { return 'util' }
}

module.exports = Configuration;
