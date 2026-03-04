**```markdown**

**# NVDB API Les v4 — Bridges and Weight / Load Restrictions**



**This document explains how to retrieve:**



**- \*\*Bridges\*\* (vegobjekttype 60)**

**- \*\*Road load class / weight restriction objects\*\* (example: vegobjekttype 893 “Bruksklasse …”)**

**- \*\*Bridge load capacity indicator\*\* (vegobjekttype 998 “Tilstandsindikator, bæreevne bru”)**



**It also explains:**



**- How to query objects inside a \*\*lat/lon bounding box\*\***

**- How to \*\*connect bridges with restriction data\*\***

**- Authentication and required headers**



**All examples refer to \*\*NVDB API Les v4 (read-only API)\*\*.**



**---**



**# 1. Authentication and Required Headers**



**## No Bearer token required**



**NVDB API Les v4 does \*\*not\*\* require OAuth2 or Bearer tokens for read access.**



**## Mandatory header: `X-Client`**



**All requests must include:**



**```**



**X-Client: YourApplicationName-Version**



**```**



**This header identifies your client application. Requests without `X-Client` will be rejected.**



**Recommended additional header:**



**```**



**Accept: application/json**



**```**



**`User-Agent` is optional but recommended.**



**---**



**# 2. Base Endpoint Pattern**



**All road object types use the same base pattern:**



**```**



**\[https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/{vegobjekttypeid}](https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/{vegobjekttypeid})**



**```**



**Where:**



**- `60`  → Bridges (Bru)**

**- `893` → Example load class / weight restriction object**

**- `998` → Bridge load capacity indicator**



**---**



**# 3. Querying by Geographic Area (Bounding Box)**



**## Parameter: `kartutsnitt`**



**Bounding box format:**



**```**



**kartutsnitt=Xmin,Ymin,Xmax,Ymax**



**```**



**The coordinates must match the selected `srid`.**



**## Parameter: `srid`**



**Specifies coordinate reference system used both for:**



**- Bounding box input**

**- Returned geometry**



**Common choices:**



**- `4326` → WGS84 (lat/lon degrees)**

**- `32633` → UTM zone 33N (meters)**



**If using lat/lon:**



**```**



**srid=4326**

**kartutsnitt=lon\_min,lat\_min,lon\_max,lat\_max**



**```**



**If using projected coordinates:**



**```**



**srid=32633**

**kartutsnitt=easting\_min,northing\_min,easting\_max,northing\_max**



**```**



**---**



**# 4. Recommended Include Parameters**



**To enable proper linking between objects, include:**



**```**



**inkluder=metadata,lokasjon,geometri,relasjoner,vegsegmenter,egenskaper**



**```**



**Important fields:**



**- `lokasjon` → Road link references and position ranges**

**- `vegsegmenter` → Road network segments**

**- `geometri` → Spatial geometry**

**- `relasjoner` → Explicit object relationships**

**- `egenskaper` → Attributes (where load class values are stored)**



**---**



**# 5. Object Type 60 — Bridges**



**\*\*Vegobjekttype 60\*\* represents bridge objects.**



**These contain:**



**- Object ID**

**- Geometry**

**- Road link references**

**- Bridge attributes**



**Example request:**



**```**



**GET /vegobjekter/api/v4/vegobjekter/60**

**?kartutsnitt=...**

**\&srid=...**

**\&inkluder=...**



**```**



**---**



**# 6. Object Type 893 — Load Class / Weight Restrictions**



**“Bruksklasse …” object types represent road load classifications and weight restrictions.**



**Type \*\*893\*\* is one example of such a load-class object.**



**Important:**



**- Weight limits are often modeled as \*\*separate road network objects\*\*, not as properties directly on bridges.**

**- These objects apply to road segments.**

**- They must be linked to bridges via location or geometry.**



**Example request:**



**```**



**GET /vegobjekter/api/v4/vegobjekter/893**

**?kartutsnitt=...**

**\&srid=...**

**\&inkluder=...**



**```**



**---**



**# 7. Object Type 998 — Bridge Load Capacity Indicator**



**Type \*\*998\*\* represents:**



**“Tilstandsindikator, bæreevne bru”**  

**(Bridge load capacity indicator)**



**This is bridge-specific information describing load capacity status.**



**These objects may:**



**- Reference a bridge via relations**

**- Share road link references with a bridge**

**- Have their own geometry**



**Example request:**



**```**



**GET /vegobjekter/api/v4/vegobjekter/998**

**?kartutsnitt=...**

**\&srid=...**

**\&inkluder=...**



**```**



**---**



**# 8. How to Connect Bridges with Weight Information**



**Because weight restrictions may exist in separate object types, joining is required.**



**## Method 1 — Explicit relations (preferred)**



**If `relasjoner` contains references between:**



**- 998 → 60**  

**or**

**- 893 → 60**  



**Then join directly by object ID.**



**This is the cleanest approach.**



**---**



**## Method 2 — Road link reference matching**



**If objects share:**



**- Same `veglenkesekvensid`**

**- Overlapping position ranges**



**Then:**



**- Match bridge segments with restriction segments**

**- Use overlap logic on position intervals**



**This is the most NVDB-native join method.**



**---**



**## Method 3 — Spatial geometry join**



**If geometry is included:**



**- Perform spatial intersection or proximity test**

**- Assign restrictions intersecting bridge geometry**



**This is simpler conceptually but computationally heavier.**



**---**



**# 9. Pagination**



**NVDB API Les v4 responses are paginated.**



**Response metadata contains a link to the next page:**



**```**



**metadata.neste.href**



**```**



**To retrieve all objects:**



**1. Perform initial request.**

**2. Append results.**

**3. Follow `metadata.neste.href` until null.**



**Do not assume all objects are returned in one response.**



**---**



**# 10. Important Caveats**



**- Bounding box filtering may return objects touching the box boundary.**

**- If strict containment is required, post-filter geometries.**

**- “Weight limit” may refer to multiple regulatory concepts:**

  **- Road load class**

  **- Special transport restrictions**

  **- Bridge-specific capacity indicators**

  **- Signed vehicle restrictions**



**Depending on your exact definition, additional object types may need to be queried.**



**---**



**# 11. Summary**



**Yes, it is possible to:**



**A) Retrieve bridges and their weight-related data**  

**B) Retrieve all such objects within a lat/lon bounding box**  



**However:**



**- Weight limits are often separate objects (e.g., type 893).**

**- Bridge capacity indicators are separate objects (type 998).**

**- Data must usually be joined using:**

  **- Relations**

  **- Road link references**

  **- Geometry overlap**



**Authentication requirements:**



**- No Bearer token required.**

**- `X-Client` header is mandatory.**

**- `Accept: application/json` recommended.**



**This structure is suitable for automated pipelines and LLM-based processing workflows.**

**```**



