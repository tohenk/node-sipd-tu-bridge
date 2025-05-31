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
     * Load roles.
     *
     * @param {string} filename Roles data
     */
    static load(filename) {
        if (this.roles === undefined) {
            this.roles = {};
        }
        if (fs.existsSync(filename)) {
            const rolesKey = [this.PA, this.BP, this.PPK, this.PPTK];
            const roles = JSON.parse(fs.readFileSync(filename));
            for (const [role, users] of Object.entries(roles.roles)) {
                let hasRoles = true;
                const userRoles = Object.keys(users);
                for (const urole of rolesKey) {
                    if (!userRoles.includes(urole)) {
                        hasRoles = false;
                        break;
                    }
                }
                if (hasRoles) {
                    if (!this.roles[role]) {
                        this.roles[role] = new this();
                    }
                    /** @var {SipdRole} */
                    const rr = this.roles[role];
                    for (const urole of rolesKey) {
                        let actor;
                        const uid = users[urole]; 
                        if (urole === this.PPTK) {
                            actor = new SipdRoleActor(urole, uid);
                        } else {
                            const u = roles.users[uid];
                            if (u) {
                                actor = new SipdRoleUser(urole, u.role, u.username, u.password);
                            } else {
                                console.error(`User ${uid} is not found!`);
                            }
                        }
                        if (actor) {
                            rr.set(urole, actor);
                        }
                    }
                }
            }
        }
        return this;
    }

    static save(filename) {
        if (this.roles) {
            const roles = {};
            const users = {};
            const rolesKey = [this.PA, this.BP, this.PPK, this.PPTK];
            for (const [role, srole] of Object.entries(this.roles)) {
                if (!roles[role]) {
                    roles[role] = {};
                }
                for (const urole of rolesKey) {
                    let uid;
                    const u = srole.get(urole);
                    if (u instanceof SipdRoleUser) {
                        uid = u.username.replace(/\s/g, '');
                        if (users[uid] === undefined) {
                            users[uid] = {
                                role: u.name,
                                username: u._username ? u._username : SipdEncryptable.encrypt(u.username),
                                password: u._password ? u._password : SipdEncryptable.encrypt(u.password),
                            }
                        }
                    } else {
                        uid = u.name;
                    }
                    roles[role][urole] = uid;
                }
            }
            const data = JSON.stringify({users, roles}, null, 4);
            if (fs.existsSync(filename)) {
                const olddata = fs.readFileSync(filename);
                if (olddata === data) {
                    return;
                } else {
                    const fileext = path.extname(filename);
                    const backupFilename = path.join(path.dirname(filename),
                        path.basename(filename, fileext) + '~' + (fileext ? '.' + fileext : ''));
                    fs.renameSync(filename, backupFilename);
                }
            }
            fs.writeFileSync(filename, data);
        }
        return this;
    }

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

    id = null
    name = null

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

    username = null
    password = null

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
        this.setUsername(username);
        this.setPassword(password);
    }

    setUsername(username) {
        const _username = SipdEncryptable.decrypt(username);
        if (_username !== username) {
            this._username = username;
            username = _username;
        }
        this.username = username;
        return this;
    }

    setPassword(password) {
        const _password = SipdEncryptable.decrypt(password);
        if (_password !== password) {
            this._password = password;
            password = _password;
        }
        this.password = password;
        return this;
    }
}

module.exports = SipdRole;