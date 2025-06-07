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

const fs = require('fs');
const path = require('path');
const SipdEncryptable = require('./encryptable');

/**
 * Role handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRole {

    actors = []

    /**
     * Get role actor.
     *
     * @param {string} roleId Role id
     * @returns {SipdRoleActor|SipdRoleUser}
     */
    get(roleId) {
        return this.actors[roleId];
    }

    /**
     * Set role actor.
     *
     * @param {string} roleId Role id
     * @param {SipdRoleActor|SipdRoleUser} actor Actor
     * @returns {SipdRole}
     */
    set(roleId, actor) {
        this.actors[roleId] = actor;
        return this;
    }

    /**
     * Set role filename.
     *
     * @param {string} filename Role filename
     * @returns {SipdRole}
     */
    static setFilename(filename) {
        this.filename = filename;
        return this;
    }

    /**
     * Load role definition.
     *
     * @param {string} role Role id
     * @param {object} data Role data
     * @param {object} users Role users
     * @returns {SipdRole}
     */
    static loadRole(role, data, users = null) {
        if (!this.roles[role]) {
            this.roles[role] = new this();
        }
        /** @var {SipdRole} */
        const rr = this.roles[role];
        for (const roleId of this.rolesKey) {
            // uid can be: reference to the user or the user itself
            let uid = data[roleId]; 
            if (roleId === this.PPTK) {
                if (!this.users[uid]) {
                    this.users[uid] = new SipdRoleActor(roleId, uid);
                }
            } else {
                let udata;
                // check if uid is the user itself
                if (typeof uid === 'object') {
                    udata = uid;
                    uid = SipdRoleUser.normalize(SipdEncryptable.decrypt(udata.username));
                } else {
                    // set user data from user reference
                    if (users) {
                        udata = users[uid];
                    }
                }
                if (udata) {
                    // add user if not exist
                    if (!this.users[uid]) {
                        this.users[uid] = new SipdRoleUser(roleId, udata.role, udata.username, udata.password);
                    } else {
                        // try update password
                        const u = this.users[uid];
                        if (u.password !== udata.password) {
                            u._password = udata.password;
                        }
                    }
                }
            }
            if (typeof uid === 'string') {
                if (this.users[uid]) {
                    rr.set(roleId, this.users[uid]);
                } else {
                    console.error(`User ${uid} is not found!`);
                }
            } else {
                console.error(`Unprocessed user data ${uid}!`);
            }
        }
        return this;
    }

    /**
     * Check if data contains role definition?
     *
     * @param {Array} roles Role data
     * @returns {boolean}
     */
    static isRoles(roles) {
        let res = true;
        const userRoles = Object.keys(roles);
        for (const roleId of this.rolesKey) {
            if (!userRoles.includes(roleId)) {
                res = false;
                break;
            }
        }
        return res;
    }

    /**
     * Load roles.
     *
     * @returns {SipdRole}
     */
    static load() {
        if (this.roles === undefined) {
            this.roles = {};
        }
        if (fs.existsSync(this.filename)) {
            this.users = {};
            const data = JSON.parse(fs.readFileSync(this.filename));
            for (const [role, roles] of Object.entries(data.roles)) {
                if (this.isRoles(roles)) {
                    this.loadRole(role, roles, data.users);
                }
            }
        }
        return this;
    }

    /**
     * Update roles.
     *
     * @param {Array} roles Roles to update
     * @returns {SipdRole}
     */
    static update(roles) {
        if (Array.isArray(roles)) {
            for (const role of roles) {
                if (role.keg && role.roles) {
                    if (this.isRoles(role.roles)) {
                        this.loadRole(role.keg, role.roles);
                    }
                }
            }
            this.save();
        }
        return this;
    }

    /**
     * Save roles.
     *
     * @returns {SipdRole}
     */
    static save() {
        this.saved = false;
        if (this.roles) {
            const roles = {};
            const users = {};
            for (const [role, srole] of Object.entries(this.roles)) {
                if (!roles[role]) {
                    roles[role] = {};
                }
                for (const roleId of this.rolesKey) {
                    let uid;
                    const u = srole.get(roleId);
                    if (u instanceof SipdRoleUser) {
                        uid = SipdRoleUser.normalize(u.username);
                        if (users[uid] === undefined) {
                            users[uid] = {
                                role: u.name,
                                username: SipdEncryptable.isDecryptable(u._username) ? u._username : SipdEncryptable.encrypt(u.username),
                                password: SipdEncryptable.isDecryptable(u._password) ? u._password : SipdEncryptable.encrypt(u.password),
                            }
                        }
                    } else {
                        uid = u.name;
                    }
                    roles[role][roleId] = uid;
                }
            }
            let data = JSON.stringify({users, roles}, null, 4);
            if (fs.existsSync(this.filename)) {
                const olddata = fs.readFileSync(this.filename);
                if (olddata.toString() === data) {
                    data = undefined;
                } else {
                    const fileext = path.extname(this.filename);
                    const backupFilename = path.join(path.dirname(this.filename),
                        path.basename(this.filename, fileext) + '~' + (fileext ? '.' + fileext : ''));
                    fs.renameSync(this.filename, backupFilename);
                }
            }
            if (data) {
                fs.writeFileSync(this.filename, data);
                this.saved = true;
            }
        }
        return this;
    }

    static get rolesKey() { return [this.PA, this.BP, this.PPK, this.PPTK] }

    static get PA() { return 'pa' }
    static get BP() { return 'bp' }
    static get PPK() { return 'ppk' }
    static get PPTK() { return 'pptk' }
}

/**
 * Role for actor.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRoleActor {

    /**
     * Constructor.
     *
     * @param {string} id Role id
     * @param {string} name Role title
     */
    constructor(id, name) {
        this.id = id;
        this.name = name;
    }
}

/**
 * Role for user.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRoleUser extends SipdRoleActor {

    /**
     * Constructor.
     *
     * @param {string} id Role id
     * @param {string} name Role title
     * @param {string} username Username
     * @param {string} password Password
     */
    constructor(id, name, username, password) {
        super(id, name);
        this._username = username;
        this._password = password;
    }

    /**
     * Get username.
     *
     * @returns {string}
     */
    get username() {
        return SipdEncryptable.decrypt(this._username);
    }

    /**
     * Get password.
     *
     * @returns {string}
     */
    get password() {
        return SipdEncryptable.decrypt(this._password);
    }

    /**
     * Normalize a string.
     *
     * @param {string} s String to normalize
     * @returns {string}
     */
    static normalize(s) {
        if (s) {
            s = s.replace(/\s/g, '');
        }
        return s;
    }
}

module.exports = SipdRole;