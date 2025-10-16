# SIPD Penatausahaan Kemendagri Automation

This tool provides automation to create SPP-LS and create LPJ (NPD and TBP) on SIPD Penatausahaan Kemendagri.
It's designed as backend service which serves the functionality to client using socket.io.

## Quickstart

```sh
node main.js --help  
```

```
Usage:
  node main.js [options]

Options:
--mode=bridge-mode, -m=bridge-mode  Set bridge mode, spp, lpj, or util
--config=filename, -c=filename      Set configuration file
--port=port, -p=port                Set server port to listen
--url=url                           Set Sipd url
--profile=profile                   Use profile for operation
--clean                             Clean profile directory
--queue, -q                         Enable queue saving and loading
--noop                              Do not process queue
--count=number                      Limit number of operation such as when fetching captcha

```

## Automation Mode

There are 3 running modes which can be set using command line argument or defined in configuration file:

* `spp`

  Serves `spp:create` to create SPP-LS and `spp:query` to query SPP-LS. Each commands accept a JSON with data
  structure described in [`/mappings/spp.meta.json`](/mappings/spp.meta.json).

* `lpj`

  Serves `lpj:create` to create LPJ (NPD and TBP) and `lpj:query` to query LPJ. Each commands accept a JSON
  with data structure described in [`/mappings/lpj.meta.json`](/mappings/lpj.meta.json).

* `util`

  Serves `util:captcha` to download captcha images and `util:noop` to test user roles.

## Data Mapping

Mapping data from a source is done using [`/mappings/spp.json`](/mappings/spp.json) for `spp` or
[`/mappings/lpj.json`](/mappings/lpj.json) for `lpj` which divide each form sections and its data fields.
The field map is using the following convention:

```
[<flags>][<parent>!][<prefix>]<field>
```

| Part     | Description                                              |
| -------- | -------------------------------------------------------- |
| flags    | Flag determine how to treat the field:                   |
|          | `?`   Perform read operation instead of fill form field  |
|          | `+`   Wait for loader after operation                    |
|          | `*`   Indicate required field                            |
|          | `~`   Indicate optional field                            |
|          | `$`   Fill value using javascript                        |
|          | `-`   Noop, used to duplicate field                      |
|          | `&`   Advance date to skip holiday                       |
| parent   | If exist the field is located within parent element.     |
| prefix   | Prefix determine how to treat selector:                  |
|          | `#`   Field selector is using id                         |
|          | `=`   Field selector is using xpath                      |

## Roles

In SIPD Penatausahaan, each user has a role as follows:

* Pengguna Anggaran
* Kuasa Pengguna Anggaran
* Bendahara Pengeluaran
* Bendahara Pengeluaran Pembantu
* PPK SKPD
* PPK Unit SKPD
* PPTK

The user credentials for SIPD Penatausahaan is stored in [`/roles/roles.json`](/roles/roles.json).
The file holds users and budgeting activities as shown as follows:

```json
{
    "users": {
        "kpa": {
            "role": "Kuasa Pengguna Anggaran",
            "name": "NAMA",
            "username": "NIP",
            "password": "PASSWORD"
        },
        "bpp": {
            "role": "Bendahara Pengeluaran Pembantu",
            "name": "NAMA",
            "username": "NIP",
            "password": "PASSWORD"
        },
        "ppk": {
            "role": "PPK Unit SKPD",
            "name": "NAMA",
            "username": "NIP",
            "password": "PASSWORD"
        },
        "pptk": {
            "role": "PPTK",
            "name": "NAMA",
            "username": "NIP",
            "password": "PASSWORD"
        }
    },
    "roles": {
        "401041010001": {
            "bpp": "bpp",
            "kpa": "kpa",
            "ppk": "ppk",
            "pptk": "pptk"
        }
    }
}
```

The client can send the credentials using `xdata` command with payload as shown:

```json
{
    "roles": [
        [
            "unit": "CHANGEME",
            "keg": "CHANGEME",
            "roles": [
                "pa": [
                    "role": "Kuasa Pengguna Anggaran",
                    "name": "CHANGEME",
                    "username": "CHANGEME",
                    "password": "CHANGEME"
                ],
                "bp": [
                    "role": "Bendahara Pengeluaran Pembantu",
                    "name": "CHANGEME",
                    "username": "CHANGEME",
                    "password": "CHANGEME"
                ],
                "ppk": [
                    "role": "PPK Unit SKPD",
                    "name": "CHANGEME",
                    "username": "CHANGEME",
                    "password": "CHANGEME"
                ],
                "pptk": [
                    "role": "PPTK",
                    "name": "CHANGEME",
                    "username": "CHANGEME",
                    "password": "CHANGEME"
                ]
            ]
        ]
    ]
}
```