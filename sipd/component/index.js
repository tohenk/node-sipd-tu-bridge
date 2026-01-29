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

const { Sipd } = require('..');
const debug = require('debug')('sipd:component');

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
        this.works = this.parent.works;
        this.initialize();
        this.components = [];
        for (const factory of this._subComponents) {
            const name = factory.name.substr(13).toLowerCase();
            const comp = new factory(this.parent, this.options);
            comp.enabled = true;
            // register exposed functions
            for (const m of Object.getOwnPropertyNames(comp.__proto__)) {
                if (m.substr(0, 1) === '_') {
                    const fn = m.substr(1);
                    debug(`Registering function ${this.constructor.name}: ${name}->${fn}...`);
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
        return this.works(works);
    }

    /**
     * Component setup handler.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        return Promise.reject('Not implemented yet!');
    }
}

module.exports = SipdComponent;