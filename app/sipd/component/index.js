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

const Sipd = require('..');
const SipdTimer = require('../timer');
const Queue = require('@ntlab/work/queue');
const { SipdOperationError } = require('../error');
const { By, error, WebElement } = require('selenium-webdriver');
const _ = require('@ntlab/ntlib/translator');

const dtag = 'component';

/**
 * SIPD interaction component abstraction.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdComponent {

    /** @type {typeof SipdComponent[]} */
    _subComponents = []

    /**
     * Constructor.
     *
     * @param {Sipd} parent Parent
     * @param {object} options Options
     */
    constructor(parent, options) {
        /** @type {Sipd} */
        this.parent = parent;
        this.options = options;
        this.works = this.parent.works.bind(this.parent);
        /** @type {?WebElement} */
        this._wrapper;
        /** @type {{name: string, selector: string, flag: number, el: ?WebElement}[]} */
        this._parts = [];
        this.initialize();
        this.components = [];
        for (const factory of this._subComponents) {
            const name = SipdComponent.getName(factory.name).toLowerCase();
            const comp = new factory(this.parent, this.options);
            comp.enabled = true;
            // register exposed functions
            for (const m of Object.getOwnPropertyNames(comp.__proto__)) {
                if (m.substr(0, 1) === '_') {
                    const fn = m.substr(1);
                    this[fn] = function(...args) {
                        return comp[fn].apply(comp, args);
                    }
                }
            }
            this[`_${name}`] = comp;
            this.components.push(comp);
        }
    }

    /**
     * Initialize component.
     */
    initialize() {
    }

    /**
     * Get component title.
     *
     * @param {boolean} withBase Include component base name
     * @returns {string}
     */
    getTitle(withBase = false) {
        return [
            withBase ? _(this.name) : null,
            this.options.name || this.options.title,
        ].filter(Boolean).join(' ');
    }

    /**
     * Set component wrapper from options.
     *
     * @returns {SipdComponent}
     */
    setWrapper() {
        if (!this.options.wrapper instanceof WebElement) {
            throw new Error(`${this.name} requires a wrapper!`);
        }
        this._wrapper = this.options.wrapper;
        return this;
    }

    /**
     * Add component part.
     *
     * @param {string} name Part name
     * @param {string} selector Element xpath selector
     * @param {?number} flag Part flag
     * @returns {SipdComponent}
     */
    setPart(name, selector, flag = null) {
        this._parts.push({name, selector, flag: flag ?? SipdComponent.OPTIONAL});
        return this;
    }

    /**
     * Reset component.
     *
     * @returns {SipdComponent}
     */
    reset() {
        this._parts = [];
        return this;
    }

    /**
     * Setup component and its sub components if necessary.
     *
     * @returns {Promise<any>}
     */
    setup() {
        const works = [
            [c => this.doSetup()]
        ];
        for (const comp of this.components) {
            works.push([c => comp.setup(), c => comp.enabled]);
        }
        if (typeof this.doPostSetup === 'function') {
            works.push([c => this.doPostSetup()]);
        }
        return new Promise((resolve, reject) => {
            this.works(works)
                .then(() => resolve())
                .catch(err => {
                    if (err instanceof error.NoSuchElementError) {
                        this.parent.isLoggedIn(false)
                            .then(res => {
                                if (res) {
                                    reject(err);
                                } else {
                                    const e = SipdOperationError.create('Session has been logged-out while setup %name%',
                                        {name: this.getTitle(true)});
                                    e.cause = err;
                                    reject(e);
                                }
                            })
                            .catch(err => reject(err));
                    } else {
                        reject(err);
                    }
                });
        });
    }

    /**
     * Component setup handler.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        return Promise.reject('Not implemented yet!');
    }

    /**
     * Component parts handler.
     *
     * @returns {Promise<any>}
     */
    queryParts() {
        for (const part of this._parts) {
            delete this[`_${part.name.toLowerCase()}`];
            delete part.el;
        }
        return this.works([
            [w => this.queryRequired()],
            [w => this.queryOptional()],
        ]);
    }

    /**
     * Query required component parts.
     *
     * @returns {Promise<undefined>}
     */
    queryRequired() {
        return new Promise((resolve, reject) => {
            const parts = this._parts
                .filter(a => a.selector && a.flag === SipdComponent.REQUIRED);
            if (parts.length) {
                const timer = new SipdTimer({delta: 10});
                const f = () => {
                    let res;
                    const q = new Queue([...parts], part => {
                        this.queryPart(part)
                            .then(found => {
                                if ((Array.isArray(found) && found.length) || found) {
                                    res = part.el = this[`_${part.name.toLowerCase()}`] = Array.isArray(found) ? found[0] : found;
                                    q.done();
                                } else {
                                    q.next();
                                }
                            })
                            .catch(err => reject(err));
                    });
                    q.once('done', () => {
                        if (res) {
                            this.parent.getHtml(res)
                                .then(html => {
                                    this.parent.debug(dtag)(_('%name% result is %result%',
                                        {name: this.getTitle(true), result: this.parent.truncate(html)}));
                                    resolve();
                                })
                                .catch(err => reject(err));
                        } else {
                            timer.check(t => this.parent.debug(dtag)(_('Still waiting %name% result after %duration%...',
                                {name: this.getTitle(true), duration: t.elapsedTime})));
                            setTimeout(() => f(), this.parent.loopdelay);
                        }
                    });
                }
                f();
            } else {
                resolve();
            }
        });
    }

    /**
     * Query optional component parts.
     *
     * @returns {Promise<undefined>}
     */
    queryOptional() {
        return new Promise((resolve, reject) => {
            const parts = this._parts
                .filter(a => a.selector && a.flag === SipdComponent.OPTIONAL);
            if (parts.length) {
                const q = new Queue([...parts], part => {
                    this.queryPart(part)
                        .then(found => {
                            if (found) {
                                part.el = this[`_${part.name.toLowerCase()}`] = found;
                            }
                            q.next();
                        })
                        .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            } else {
                resolve();
            }
        });
    }

    /**
     * Query component part.
     *
     * @returns {Promise<?WebElement|WebElement[]>}
     */
    queryPart(part) {
        return new Promise((resolve, reject) => {
            if (Array.isArray(part.selector)) {
                const res = [];
                const q = new Queue([...part.selector], selector => {
                    this._wrapper.findElements(By.xpath(selector))
                        .then(found => {
                            res.push(found.length ? found[0] : undefined);
                            q.next();
                        })
                        .catch(err => reject(err));
                });
                q.once('done', () => resolve(res));
            } else {
                this._wrapper.findElements(By.xpath(part.selector))
                    .then(found => resolve(found.length ? found[0] : undefined))
                    .catch(err => reject(err));
            }
        });
    }

    /**
     * Component name.
     *
     * @returns {string}
     */
    get name() {
        return SipdComponent.getName(this.constructor.name);
    }

    /**
     * Get component name.
     *
     * @param {string} name Component name
     * @returns {string}
     */
    static getName(name) {
        return name.substr(13);
    }

    static get REQUIRED() { return 1 }
    static get OPTIONAL() { return 2 }
}

module.exports = SipdComponent;