// CY2026 CMS Home Health PPS wage index — PENNSYLVANIA counties (bundled).
//
// Every value below was extracted VERBATIM from the official CMS file — no
// wage index, CBSA code, label, or county↔CBSA assignment was authored or
// estimated by hand:
//   Source:    CY 2026 Final HH PPS Wage Index.xlsx
//   Published: https://www.cms.gov/files/zip/cy-2026-final-hh-pps-wage-index.zip
//              (CMS "Home Health PPS Wage Index" page), file dated 2025-11-21
//   Retrieved: 2026-08-29
//   Tabs used: "Urban Areas" (17 CBSAs containing PA counties; multi-state
//              CBSAs keep only their PA counties here), "Transition Codes"
//              (Pike County: CY2026 code 50023 with the 5% cap), and
//              "Rural Areas" (statewide rural PA, CBSA 99939). Per CMS rules
//              every county in no urban CBSA takes the statewide rural index,
//              so the rural row lists the 33 remaining counties from the
//              Census Bureau's 67-county PA roster (codes2020/cou/st42).
//
// Rows are in the exact shape parseWageIndexCsv produces and
// PDGMRateConfig.wage_index_table.rows stores. zip_prefixes are deliberately
// empty — the CMS file is county-based and ZIP mappings are never invented;
// matching uses the county name in the patient's address.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK.

export const PA_WAGE_INDEX_CY2026 = {
  source_file: "CY 2026 Final HH PPS Wage Index.xlsx (CMS, bundled: PA counties)",
  source_url: "https://www.cms.gov/files/zip/cy-2026-final-hh-pps-wage-index.zip",
  payment_year: "2026",
  retrieved_at: "2026-08-29",
  rows: [
    {
      "cbsa": "10900",
      "label": "Allentown-Bethlehem-Easton, PA-NJ",
      "wage_index": 0.9978,
      "counties": [
        "carbon",
        "lehigh",
        "northampton"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "11020",
      "label": "Altoona, PA",
      "wage_index": 0.8641,
      "counties": [
        "blair"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "16540",
      "label": "Chambersburg, PA",
      "wage_index": 1.0154,
      "counties": [
        "franklin"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "21500",
      "label": "Erie, PA",
      "wage_index": 0.845,
      "counties": [
        "erie"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "23900",
      "label": "Gettysburg, PA",
      "wage_index": 1.0071,
      "counties": [
        "adams"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "25420",
      "label": "Harrisburg-Carlisle, PA",
      "wage_index": 1.0055,
      "counties": [
        "cumberland",
        "dauphin",
        "perry"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "27780",
      "label": "Johnstown, PA",
      "wage_index": 0.7921,
      "counties": [
        "cambria"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "29540",
      "label": "Lancaster, PA",
      "wage_index": 0.8644,
      "counties": [
        "lancaster"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "30140",
      "label": "Lebanon, PA",
      "wage_index": 1.0038,
      "counties": [
        "lebanon"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "33874",
      "label": "Montgomery County-Bucks County-Chester County, PA",
      "wage_index": 0.9618,
      "counties": [
        "bucks",
        "chester",
        "montgomery"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "37964",
      "label": "Philadelphia, PA",
      "wage_index": 1.0364,
      "counties": [
        "delaware",
        "philadelphia"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "38300",
      "label": "Pittsburgh, PA",
      "wage_index": 0.8463,
      "counties": [
        "allegheny",
        "armstrong",
        "beaver",
        "butler",
        "fayette",
        "lawrence",
        "washington",
        "westmoreland"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "39740",
      "label": "Reading, PA",
      "wage_index": 1.0205,
      "counties": [
        "berks"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "42540",
      "label": "Scranton--Wilkes-Barre, PA",
      "wage_index": 0.8797,
      "counties": [
        "lackawanna",
        "luzerne",
        "wyoming"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "44300",
      "label": "State College, PA",
      "wage_index": 1.1283,
      "counties": [
        "centre"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "48700",
      "label": "Williamsport, PA",
      "wage_index": 0.8077,
      "counties": [
        "lycoming"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "49620",
      "label": "York-Hanover, PA",
      "wage_index": 0.9375,
      "counties": [
        "york"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "50023",
      "label": "Pennsylvania (CY2026 transition code \u2014 Pike County, 5% cap)",
      "wage_index": 1.0188,
      "counties": [
        "pike"
      ],
      "zip_prefixes": []
    },
    {
      "cbsa": "99939",
      "label": "Pennsylvania (statewide rural)",
      "wage_index": 0.8507,
      "counties": [
        "bedford",
        "bradford",
        "cameron",
        "clarion",
        "clearfield",
        "clinton",
        "columbia",
        "crawford",
        "elk",
        "forest",
        "fulton",
        "greene",
        "huntingdon",
        "indiana",
        "jefferson",
        "juniata",
        "mckean",
        "mercer",
        "mifflin",
        "monroe",
        "montour",
        "northumberland",
        "potter",
        "schuylkill",
        "snyder",
        "somerset",
        "sullivan",
        "susquehanna",
        "tioga",
        "union",
        "venango",
        "warren",
        "wayne"
      ],
      "zip_prefixes": []
    }
],
};
