/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2026 Toha <tohenk@yahoo.com>
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

const SipdUtil = require('../../sipd/util');
const { SipdColumnQuery } = require('../../sipd/query');

/**
 * Default column query normalizers and stringables.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdFn {

    /**
     * Set query column normalizer.
     *
     * @param {string} name Normalizer name
     * @param {Function} fn Normalizer handler
     * @returns {typeof SipdFn}
     */
    static setNormalizer(name, fn) {
        if (SipdColumnQuery.normalizers[name] === undefined) {
            SipdColumnQuery.normalizers[name] = fn;
        }
        return this;
    }

    /**
     * Set query column stringable.
     *
     * @param {string} name Stringable name
     * @param {Function} fn Stringable handler
     * @returns {typeof SipdFn}
     */
    static setStringable(name, fn) {
        if (SipdColumnQuery.stringables[name] === undefined) {
            SipdColumnQuery.stringables[name] = fn;
        }
        return this;
    }

    static init() {
        if (this.initialized === undefined) {
            this.initialized = true;
            const normalizers = {
                default: value => typeof value === 'string' ? SipdUtil.getSafeStr(value) : value,
                nama: value => {
                    if (typeof value === 'string') {
                        value = SipdUtil.getSafeStr(value);
                        if (value.includes('\n')) {
                            value = value.split('\n')[0];
                        }
                    }
                    return value;
                },
                nom: value => parseFloat(SipdUtil.pickCurr(value)),
                nr: value => SipdUtil.pickNumber(value),
                num: value => parseInt(SipdUtil.pickNumber(value)),
                ref: value => SipdUtil.pickNr(value),
                tgl: value => SipdUtil.getDate(value),
            }
            const stringables = {
                default: value => value.toString(),
                nom: value => SipdUtil.fmtCurr(value),
                tgl: value => SipdUtil.dateSerial(value),
            }
            for (const [normalizer, fn] of Object.entries(normalizers)) {
                this.setNormalizer(normalizer, fn);
            }
            for (const [stringable, fn] of Object.entries(stringables)) {
                this.setStringable(stringable, fn);
            }
        }
        return this;
    }
}

module.exports = SipdFn.init();