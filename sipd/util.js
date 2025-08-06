/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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

/**
 * An SIPD utility.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdUtil {

    /**
     * Escape single or double quote for xpath expression.
     *
     * @param {string} s String expression
     * @returns {string}
     * @see https://stackoverflow.com/questions/642125/encoding-xpath-expressions-with-both-single-and-double-quotes
     */
    static escapeStr(s) {
        if (typeof s !== 'string') {
            s = '' + s;
        }
        // does not contain double quote
        if (s.indexOf('"') < 0) {
            return `"${s}"`;
        }
        // does not contain single quote
        if (s.indexOf('\'') < 0) {
            return `'${s}'`;
        }
        // contains both, escape single quote
        return `concat('${s.replace(/'/g, '\', "\'", \'')}')`;
    }

    /**
     * Ensure date is a date object.
     *
     * @param {string|number|Date} date The date
     * @param {boolean} skipHoliday True to skip week end
     * @returns {Date}
     */
    static getDate(date, skipHoliday = false) {
        if (date && (!isNaN(date) || typeof date === 'string')) {
            // try to get date portion, e.g. 06 Agustus 2025
            if (typeof date === 'string') {
                const matches = date.match(/\d{2}\s[A-Za-z]+\s\d{4}/);
                if (matches) {
                    date = matches[0];
                }
            }
            if (typeof date === 'string' && date.indexOf(' ') > 0) {
                // 25 June 2025 - 12:00 PM
                if (date.endsWith('AM') || date.endsWith('PM')) {
                    date = date.substr(0, date.indexOf('-')).trim();
                }
                const dt = date.split(' ');
                if (dt.length === 3) {
                    let d, m, y;
                    for (const part of dt) {
                        if (!isNaN(part)) {
                            if (part.length === 4) {
                                y = parseInt(part);
                            } else {
                                d = parseInt(part);
                            }
                        } else {
                            m = this.getMonth(part) + 1;
                        }
                    }
                    if (d !== undefined && m !== undefined && y !== undefined) {
                        date = [y.toString(), m.toString().padStart(2, '0'), d.toString().padStart(2, '0')].join('-');
                    }
                } else if (dt[1] === '00:00:00') {
                    date = dt[0];
                }
            }
            if (typeof date === 'string' && date.indexOf('/') > 0) {
                const dtpart = date.split('/');
                if (dtpart.length === 3) {
                    date = Date.UTC(parseInt(dtpart[2]), parseInt(dtpart[1]) - 1, parseInt(dtpart[0]));
                }
            }
            date = new Date(date);
        }
        if (date && skipHoliday) {
            while (true) {
                if ([0, 6].indexOf(date.getDay()) < 0) {
                    break;
                }
                date.setDate(date.getDate() + 1);
            }
        }
        return date;
    }

    /**
     * Get month index from month name.
     *
     * @param {string} s Month name
     * @returns {number}
     */
    static getMonth(s) {
        if (typeof s === 'string') {
            s = s.substring(0, 3);
            const month = ['Jan', 'Feb', 'Mar', 'Apr', ['May', 'Mei'], 'Jun', 'Jul', ['Aug', 'Agu'], 'Sep', ['Oct', 'Okt'], ['Nov', 'Nop'], ['Dec', 'Des']];
            month.forEach((m, i) => {
                const mm = Array.isArray(m) ? m : [m];
                mm.forEach(x => {
                    if (s === x) {
                        s = i;
                        return true;
                    }
                });
                if (s == i) {
                    return true;
                }
            });
        }
        return s;
    }

    /**
     * Get serialized value of date.
     *
     * @param {Date} date The date
     * @returns {number}
     */
    static dateSerial(date) {
        if (date) {
            return (date.getFullYear() * 10000) + ((date.getMonth() + 1) * 100) + date.getDate();
        }
    }

    /**
     * Create date from date string.
     *
     * @param {string} s The date
     * @returns {Date}
     */
    static dateCreate(s) {
        const x = s.split(' ');
        return new Date(Date.UTC(parseInt(x[1]), this.getMonth(x[0]), 1));
    }

    /**
     * Get month differences of first and second date.
     *
     * @param {Date} dt1 First date
     * @param {Date} dt2 Second date
     * @returns {number}
     */
    static dateDiffMonth(dt1, dt2) {
        const d1 = (dt1.getFullYear() * 12) + dt1.getMonth() + 1;
        const d2 = (dt2.getFullYear() * 12) + dt2.getMonth() + 1;
        return d1 - d2;
    }

    /**
     * Pick the number only of number string.
     *
     * @param {string} s The number string
     * @returns {string}
     */
    static pickNumber(s) {
        let result = '';
        for (let i = 0; i < s.length; i++) {
            if (!isNaN(s.charAt(i))) {
                result += s.charAt(i);
            }
        }
        return result.trim();
    }

    /**
     * Pick the currency of number string.
     *
     * @param {string} s Number string
     * @returns {string}
     */
    static pickCurr(s) {
        if (s) {
            const matches = s.match(/([0-9\.]+)/);
            if (matches) {
                return this.pickNumber(matches[0]);
            }
        }
    }

    /**
     * Format number as currency.
     *
     * @param {number} value The value
     * @returns {string}
     */
    static fmtCurr(value) {
        if (value !== undefined && value !== null) {
            let s = value.toString();
            value = '';
            while (s.length) {
                if (value.length) {
                    value = '.' + value;
                }
                value = s.substr(-3) + value;
                s = s.substr(0, s.length - 3);
            }
        }
        return value;
    }

    /**
     * Get safe string by replacing multiple whitespace occurances with single one.
     *
     * @param {string} s The input string
     * @returns {string}
     */
    static getSafeStr(s) {
        if (s) {
            return s.replace(/\s{2,}/g, ' ').trim();
        }
    }
}

module.exports = SipdUtil;