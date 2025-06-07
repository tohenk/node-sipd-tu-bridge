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

/**
 * Encryption handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdEncryptable {

    /**
     * Get encryption secret key.
     *
     * @returns {crypto.KeyObject}
     */
    static enckey() {
        if (process.env.ENC_KEY) {
            const buff = Buffer.from(process.env.ENC_KEY, 'hex');
            if (buff.length === this.ENC_KEYLEN) {
                return crypto.createSecretKey(buff);
            } else {
                console.error(`Secret key size must to be ${this.ENC_KEYLEN}!`);
            }
        }
    }

    /**
     * Perform encryption.
     *
     * @param {string} s Plain text to encrypt
     * @returns {string}
     */
    static encrypt(s) {
        if (s) {
            const key = this.enckey();
            if (key) {
                const nonce = crypto.randomBytes(this.ENC_NONCELEN);
                const cipher = crypto.createCipheriv(this.ENC_ALGORITHM, key, nonce);
                let encoded = cipher.update(s, 'utf8', 'hex');
                encoded += cipher.final('hex');
                return this.ENC_IDENTIFIER + nonce.toString('hex') + this.ENC_DELIMITER + encoded;
            }
        }
        return s;
    }

    /**
     * Perform decryption.
     *
     * @param {string} s Encoded text to decrypt
     * @returns {string}
     */
    static decrypt(s) {
        if (this.isDecryptable(s)) {
            const key = this.enckey();
            if (key) {
                const parts = s.substr(1).split(this.ENC_DELIMITER);
                const nonce = Buffer.from(parts[0], 'hex');
                const decipher = crypto.createDecipheriv(this.ENC_ALGORITHM, key, nonce);
                let decoded = decipher.update(parts[1], 'hex', 'utf8');
                decoded += decipher.final('utf8');
                return decoded;
            } else {
                throw new Error('Encryption requires ENC_KEY environment to be set!');
            }
        }
        return s;
    }

    /**
     * Check if a string is decrytable?
     *
     * @param {string} s String to check
     * @returns {boolean}
     */
    static isDecryptable(s) {
        return s && s.startsWith(this.ENC_IDENTIFIER) && s.includes(this.ENC_DELIMITER);
    }

    static get ENC_ALGORITHM() { return 'aes-256-cbc' }
    static get ENC_KEYLEN() { return 32 }
    static get ENC_NONCELEN() { return 16 }
    static get ENC_IDENTIFIER() { return '?' }
    static get ENC_DELIMITER() { return ':' }
}

module.exports = SipdEncryptable;