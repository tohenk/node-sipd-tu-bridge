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

const { SipdReader, SipdReaderBase } = require('.');

/**
 * Reads page and extract data information within.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdTbpReader extends SipdReader {

    initialize() {
        this.addReader('keyvalue', SipdTbpReader.KEY, {
            readAs: SipdReaderBase.AS_VALUES,
            rowSelector: './/table[1]/tbody/tr[1]/td/div',
            keySelector: './/div[@class="col-span-2"]/p',
            valueSelector: './/div[@class="col-span-10"]/div/p[2]',
            normalize: {
                NAMA: {label: 'Kepada'},
                ALAMAT: {label: 'Alamat'},
                NPWP: {label: 'NPWP'},
                BANK: {label: 'Nama Bank'},
                BANK_REK: {label: 'Nomor Rekening Bank'},
                BANK_NAMA: {label: 'Nama di Rekening Bank'},
                BAYAR: {label: 'Jenis Transaksi'},
                NO_NPD: {label: 'Nomor NPD'},
                URAIAN: {label: 'Untuk Keperluan'},
            }
        });
        this.addReader('value', SipdTbpReader.KEY, {
            readAs: SipdReaderBase.AS_VALUES,
            name: 'Sub Kegiatan',
            selector: './/table[1]/tbody/tr[5]/td',
            normalize: {
                KEG: {label: 'Sub Kegiatan', normalizer: 'nr'},
            }
        });
        this.addReader('table', SipdTbpReader.KEY, {
            readAs: SipdReaderBase.AS_VALUES,
            headerSelector: 'tbody/tr[3]',
            dataSelector: 'tbody/tr[8]',
            normalize: {
                REK: {label: 'Kode Rekening', normalizer: 'nr'},
                REKENING: {label: 'Uraian', normalizer: v => v.split('\n')[0]},
                AFEKTASI: {label: 'Jumlah', normalizer: 'nom'},
            }
        });
        this.addReader('table', `${SipdTbpReader.KEY}.PAJAK`, {
            readAs: SipdReaderBase.AS_COLLECTION,
            headerSelector: 'tbody/tr[12]',
            dataSelector: 'tbody/tr[13]',
            valueSelector: 'th',
            normalize: {
                PAJAK: {label: 'Uraian'},
                BILLING: {label: 'ID Billing', normalizer: 'nr'},
                AFEKTASI: {label: 'Jumlah', normalizer: 'nom'},
            }
        });
    }

    static get KEY() { return 'trx' }
}

module.exports = SipdTbpReader;