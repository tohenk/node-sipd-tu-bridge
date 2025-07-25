# SIPD Penatausahaan Kemendagri Automation

SPP automation bridge for App Hibah Biro Kesejahteraan Rakyat.

## Data Mapping

Mapping data from a source is done using `maps.json` which divide each form sections and its data fields.
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

`roles.json` holds users and budgeting activities.

```json
{
    "users": {
        "kpa": {
            "role": "Kuasa Pengguna Anggaran",
            "name": "CHANGEME",
            "username": "CHANGEME",
            "password": "CHANGEME"
        },
        "bpp": {
            "role": "Bendahara Pengeluaran Pembantu",
            "name": "CHANGEME",
            "username": "CHANGEME",
            "password": "CHANGEME"
        },
        "ppk": {
            "role": "PPK Unit SKPD",
            "name": "CHANGEME",
            "username": "CHANGEME",
            "password": "CHANGEME"
        },
        "pptk": {
            "role": "PPTK",
            "name": "CHANGEME",
            "username": "CHANGEME",
            "password": "CHANGEME"
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