/** Loaded by the "Sample" action; exercises every JSON value type. */
export const SAMPLE_JSON = `{
  "workspace": "field-inventory",
  "revision": 42,
  "offline": true,
  "syncedAt": null,
  "owner": {
    "name": "Ada Okonkwo",
    "role": "site lead",
    "contact": { "email": "ada@example.invalid", "extension": 4417 }
  },
  "sites": [
    {
      "id": "SITE-001",
      "label": "North Ridge",
      "coordinates": [52.3702, 4.8952],
      "active": true,
      "readings": [18.4, 19.1, 17.9, 21.5],
      "tags": ["solar", "remote"],
      "notes": "Panel 3 replaced\\nawaiting calibration"
    },
    {
      "id": "SITE-002",
      "label": "Harbour Yard",
      "coordinates": [51.9244, 4.4777],
      "active": false,
      "readings": [],
      "tags": ["wind"],
      "notes": null
    }
  ],
  "thresholds": { "warning": 22.5, "critical": 27, "unit": "°C" },
  "ledgerId": 9007199254740993,
  "checksum": "b7f0e1c4-2a55-4d09-9d6a-3f1c8e2b7a10"
}`
