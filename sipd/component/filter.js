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

const Queue = require('@ntlab/work/queue');
const SipdComponent = require('.');
const SipdUtil = require('../util');
const { By } = require('selenium-webdriver');

const dtag = 'filter';

/**
 * SIPD data filtering component.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdComponentFilter extends SipdComponent {

    /**
     * Do setup.
     *
     * @returns {Promise<any>}
     */
    doSetup() {
        this._title = this.options.title;
        this._wrapper = this.options.wrapper;
        this._filterToggle = this.options.filterToggle !== undefined ?
            this.options.filterToggle : true;
        return this.setupFiltering(this.options.filter);
    }

    /**
     * Setup page filtering form element.
     *
     * @param {object} data Search model object
     * @param {By} data.toggler Toggler element to expand the filter form
     * @param {By|By[]} data.input Text input element
     * @param {By} data.filter Filter choices element
     * @param {By} data.submit Form submit element
     * @returns {Promise<any>}
     */
    setupFiltering(data) {
        this.data = data;
        return this.works([
            [w => Promise.reject('Wrapper is required!'), w => !this._wrapper],
            [w => this._wrapper.findElement(data.toggler), w => data.toggler],
            [w => Promise.resolve(this._toggler = w.res), w => data.toggler],
            [w => this._wrapper.findElement(data.filter), w => data.filter],
            [w => Promise.resolve(this._choices = w.res), w => data.filter],
            [w => new Promise((resolve, reject) => {
                if (Array.isArray(data.input)) {
                    const res = [];
                    const q = new Queue([...data.input], input => {
                        this._wrapper.findElement(input)
                            .then(el => {
                                res.push(el);
                                q.next();
                            })
                            .catch(err => reject(err));
                    });
                    q.once('done', () => resolve(res));
                } else {
                    this._wrapper.findElement(data.input)
                        .then(el => resolve(el))
                        .catch(err => reject(err));
                }
            }), w => data.input],
            [w => Promise.resolve(this._filter = w.res), w => data.input],
            [w => this._wrapper.findElement(data.submit), w => data.submit],
            [w => Promise.resolve(this._submit = w.res), w => data.submit],
        ]);
    }

    /**
     * Apply data filtering on page.
     *
     * @param {string|string[]} value Filter value
     * @param {string} key Filter key
     * @returns {Promise<any>}
     */
    apply(value, key = null) {
        return this.works([
            [w => Promise.reject('Filter component is not initialized!'), w => !this._filter],
            [w => this._toggler.getAttribute('aria-expanded'), w => this._toggler],
            [w => this.parent.clickExpanded(this._toggler), w => this._toggler && w.getRes(1) === 'false'],
            [w => this._choices.click(), w => this._choices && key],
            [w => this._choices.findElements(By.xpath(`./../*/*/button/span/p[text()="${key}"]/../..`)), w => this._choices && key],
            [w => Promise.reject(`No filter key found for ${key}!`), w => this._choices && key && !w.getRes(4).length],
            [w => w.getRes(4)[0].click(), w => this._choices && key && w.getRes(4).length],
            [w => new Promise((resolve, reject) => {
                if (Array.isArray(this._filter) && !Array.isArray(value)) {
                    return reject('Filter value must be an array!');
                }
                const selectors = Array.isArray(this._filter) ? this.data.input : [this.data.input];
                const searches = Array.isArray(this._filter) ? this._filter : [this._filter];
                const values = Array.isArray(this._filter) ? value : [value];
                const queues = [];
                for (let i = 0; i < searches.length; i++) {
                    queues.push({el: searches[i], value: values[i], selector: selectors[i]});
                }
                const q = new Queue(queues, s => {
                    const data = {
                        elements: [s.el],
                        value: SipdUtil.escapeTerm(s.value),
                        clearUsingKey: this.parent.options.clearUsingKey,
                    }
                    this.parent.debug(dtag)(`Applying filter ${s.selector} with ${data.value}`);
                    this.parent.fillFormValue(data)
                        .then(() => q.next())
                        .catch(err => reject(err));
                });
                q.once('done', () => resolve());
            })],
            [w => this._submit.click(), w => this._submit],
            [w => this.onfilter(), w => typeof this.onfilter === 'function'],
            [w => this.parent.gotoPageTop(), w => this._toggler && this._filterToggle],
            [w => this.parent.clickExpanded(this._toggler, false), w => this._toggler && this._filterToggle],
        ]);
    }
}

module.exports = SipdComponentFilter;