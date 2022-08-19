# SIAP Kemendagri Automation

SPP automation bridge for App Hibah Biro Kesejahteraan Rakyat.

## Data Mapping

Mapping data from a source is done using `maps.json` which divide each form sections and its data fields.
The field map is using the following convention:

```
[<parent>!][<prefixes>]<field>
```

| Part     | Description                                              |
| -------- | -------------------------------------------------------- |
| parent   | If exist the field is located within parent element.     |
| prefixes | Prefix determine how to treat the field:                 |
|          | `#`   Field selector is using id                         |
|          | `=`   Field selector is using xpath                      |
|          | `?`   Perform read operation instead of fill form field  |
|          | `+`   Wait for loader after operation                    |