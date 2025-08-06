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
 * Role switcher.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRoleSwitcher {

    roles = {}
    users = {}

    /**
     * Set role definition.
     *
     * @param {string} role Role id
     * @param {object} data Role data
     * @param {object} users Role users
     * @returns {SipdRoleSwitcher}
     */
    setRole(role, data, users = null) {
        if (!this.roles[role]) {
            this.roles[role] = new SipdRole();
        }
        /** @var {SipdRole} */
        const rr = this.roles[role];
        for (const roleId of this.constructor.rolesKey) {
            // uid can be: reference to the user or the user itself
            let uid = data[roleId], udata; 
            // check if uid is the user itself
            if (typeof uid === 'object') {
                udata = uid;
                uid = this.constructor.genUid(SipdRoleUser.normalize(SipdEncryptable.decrypt(udata.username)));
            } else {
                // set user data from user reference
                if (users) {
                    udata = users[uid];
                }
            }
            if (udata) {
                // add user if not exist
                if (!this.users[uid]) {
                    this.users[uid] = new SipdRoleUser(roleId, udata.role, udata.name, udata.username, udata.password);
                } else {
                    // try update password
                    const u = this.users[uid];
                    if (u.password !== udata.password) {
                        u._password = udata.password;
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
     * Load roles.
     *
     * @param {boolean} force Set to true to force load
     * @returns {SipdRoleSwitcher}
     */
    load(force = null) {
        const filename = path.join(this.constructor._dir, path.basename(this.filename));
        if (fs.existsSync(filename) && (force || this.loaded === undefined)) {
            this.loaded = true;
            const data = JSON.parse(fs.readFileSync(filename));
            if (data.roles) {
                for (const [role, roles] of Object.entries(data.roles)) {
                    if (this.constructor.isRoles(roles)) {
                        this.setRole(role, roles, data.users);
                    }
                }
            }
        }
        return this;
    }

    /**
     * Save roles.
     *
     * @returns {SipdRoleSwitcher}
     */
    save() {
        this.saved = false;
        const roles = {};
        const users = {};
        for (const [role, srole] of Object.entries(this.roles)) {
            if (!roles[role]) {
                roles[role] = {};
            }
            for (const roleId of this.constructor.rolesKey) {
                const u = srole.get(roleId);
                if (u instanceof SipdRoleUser) {
                    const uid = this.constructor.genUid(SipdRoleUser.normalize(u.username));
                    if (users[uid] === undefined) {
                        users[uid] = {
                            role: u.role,
                            name: SipdEncryptable.isDecryptable(u._name) ? u._name : SipdEncryptable.encrypt(u.name),
                            username: SipdEncryptable.isDecryptable(u._username) ? u._username : SipdEncryptable.encrypt(u.username),
                            password: SipdEncryptable.isDecryptable(u._password) ? u._password : SipdEncryptable.encrypt(u.password),
                        }
                    }
                    roles[role][roleId] = uid;
                }
            }
        }
        let data = JSON.stringify({users, roles}, null, 4);
        const filename = path.join(this.constructor._dir, path.basename(this.filename));
        if (fs.existsSync(filename)) {
            const olddata = fs.readFileSync(filename);
            if (olddata.toString() === data) {
                data = undefined;
            } else {
                const fileext = path.extname(filename);
                const backupFilename = path.join(path.dirname(filename),
                    path.basename(filename, fileext) + '~' + (fileext ? fileext : ''));
                fs.renameSync(filename, backupFilename);
            }
        }
        if (data) {
            fs.writeFileSync(filename, data);
            this.saved = true;
        }
        return this;
    }

    /**
     * Update roles.
     *
     * @param {Array} roles Roles to update
     * @returns {SipdRoleSwitcher}
     */
    update(roles) {
        if (Array.isArray(roles)) {
            for (const role of roles) {
                if (role.keg && role.roles) {
                    if (this.constructor.isRoles(role.roles)) {
                        this.setRole(role.keg, role.roles);
                    }
                }
            }
            this.save();
        }
        return this;
    }

    /**
     * Set roles directory.
     *
     * @param {string} dir Roles directory
     */
    static setDir(dir) {
        this._dir = dir;
        return this;
    }

    /**
     * Switch roles to unit.
     *
     * @param {string} unit Unit id
     * @returns {SipdRoleSwitcher}
     */
    static switchTo(unit = null) {
        const filename = `${unit ?? 'roles'}.json`;
        if (this._items === undefined) {
            this._items = {};
        }
        unit = unit ?? '_';
        if (this._items[unit] === undefined) {
            this._items[unit] = new this();
        }
        this._items[unit].filename = filename;
        return this._items[unit];
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

    static genUid(username) {
        return require('crypto')
            .createHash('sha1')
            .update(username)
            .digest('hex')
            .substring(0, 8);
    }

    static get rolesKey() { return [SipdRole.PA, SipdRole.BP, SipdRole.PPK, SipdRole.PPTK] }
}

/**
 * Role holder.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRole {

    actors = {}

    /**
     * Get role actor.
     *
     * @param {string} roleId Role id
     * @returns {SipdRoleUser}
     */
    get(roleId) {
        return this.actors[roleId];
    }

    /**
     * Set role actor.
     *
     * @param {string} roleId Role id
     * @param {SipdRoleUser} actor Actor
     * @returns {SipdRole}
     */
    set(roleId, actor) {
        this.actors[roleId] = actor;
        return this;
    }

    static get PA() { return 'pa' }
    static get BP() { return 'bp' }
    static get PPK() { return 'ppk' }
    static get PPTK() { return 'pptk' }
}

/**
 * Role for user.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRoleUser {

    /**
     * Constructor.
     *
     * @param {string} id Role id
     * @param {string} role Role name
     * @param {string} name Person name
     * @param {string} username Username
     * @param {string} password Password
     */
    constructor(id, role, name, username, password) {
        this.id = id;
        this.role = role;
        this._name = name;
        this._username = username;
        this._password = password;
    }

    /**
     * Get person name.
     *
     * @returns {string}
     */
    get name() {
        return SipdEncryptable.decrypt(this._name);
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

module.exports = {SipdRoleSwitcher, SipdRole};