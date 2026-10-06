[xml]$sheet = Get-Content -Raw "temp_xlsx_dump\xl\worksheets\sheet1.xml"
$ns = New-Object System.Xml.XmlNamespaceManager($sheet.NameTable)
$ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
$rows = $sheet.SelectNodes("//x:row", $ns)

function Parse-ExpiryDate($raw) {
    if ([string]::IsNullOrWhiteSpace($raw) -or $raw -match "Damage") {
        return ""
    }
    
    $clean = $raw -replace "\[.*?\]", ""
    $clean = $clean -replace "corrected from.*", ""
    $clean = $clean -replace "[^\x20-\x7E]", ""
    $clean = $clean.Trim()

    if ([string]::IsNullOrWhiteSpace($clean) -or $clean -eq "-") {
        return ""
    }

    $oaNum = 0.0
    if ([double]::TryParse($clean, [ref]$oaNum) -and $oaNum -gt 30000 -and $oaNum -lt 60000) {
        return [DateTime]::FromOADate($oaNum).ToString("yyyy-MM-dd")
    }

    if ($clean -match "^([A-Za-z]{3})\s+(\d{2})$") {
        $mStr = $matches[1]
        $yStr = "20" + $matches[2]
        $dt = [DateTime]::ParseExact("01-$mStr-$yStr", "dd-MMM-yyyy", [System.Globalization.CultureInfo]::InvariantCulture)
        $daysInMonth = [DateTime]::DaysInMonth($dt.Year, $dt.Month)
        return (New-Object DateTime($dt.Year, $dt.Month, $daysInMonth)).ToString("yyyy-MM-dd")
    }

    if ($clean -match "^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$") {
        $d = [int]$matches[1]
        $m = $matches[2]
        $y = if ($matches[3].Length -eq 2) { "20" + $matches[3] } else { $matches[3] }
        $dt = [DateTime]::ParseExact("$d-$m-$y", "d-MMM-yyyy", [System.Globalization.CultureInfo]::InvariantCulture)
        return $dt.ToString("yyyy-MM-dd")
    }

    if ($clean -match "^(\d{1,2})/(\d{2,4})$") {
        $m = [int]$matches[1]
        $y = if ($matches[2].Length -eq 2) { 2000 + [int]$matches[2] } else { [int]$matches[2] }
        $daysInMonth = [DateTime]::DaysInMonth($y, $m)
        return (New-Object DateTime($y, $m, $daysInMonth)).ToString("yyyy-MM-dd")
    }

    if ($clean -match "^(\d{1,2})/(\d{1,2})/(\d{2,4})$") {
        $d = [int]$matches[1]
        $m = [int]$matches[2]
        $y = if ($matches[3].Length -eq 2) { 2000 + [int]$matches[3] } else { [int]$matches[3] }
        return (New-Object DateTime($y, $m, $d)).ToString("yyyy-MM-dd")
    }

    if ($raw -match "04/.*26") {
        return "2026-04-30"
    }

    return ""
}

function Clean-Text($val) {
    if ([string]::IsNullOrWhiteSpace($val)) { return "" }
    $t = $val -replace "\[\?\]", ""
    $t = $t -replace "\[unclear\]", ""
    $t = $t -replace "\[.*?\]", ""
    $t = $t -replace "[^\x20-\x7E]", ""
    $t = $t.Trim()
    return $t
}

function Clean-Pieces($val) {
    if ([string]::IsNullOrWhiteSpace($val) -or $val -match "Damage") { return 0 }
    if ($val -match "(\d+)") { return [int]$matches[1] }
    return 0
}

function Clean-MRP($val) {
    if ([string]::IsNullOrWhiteSpace($val) -or $val -match "Damage") { return 0.0 }
    if ($val -match "(\d+(\.\d+)?)") { return [double]$matches[1] }
    return 0.0
}

$products = @()
$counter = 0

foreach ($r in $rows) {
    $rowIdx = [int]$r.GetAttribute("r")
    if ($rowIdx -lt 8 -or $rowIdx -gt 252) { continue }
    $counter++

    $cells = @{}
    foreach ($c in $r.SelectNodes("x:c", $ns)) {
        $ref = $c.GetAttribute("r")
        $col = $ref -replace "[0-9]",""
        $val = ""
        if ($c.is) { $val = $c.is.t }
        elseif ($c.v) { $val = $c.v }
        $cells[$col] = $val
    }

    $rawName = $cells["C"]
    $rawPack = $cells["D"]
    $rawPieces = $cells["E"]
    $rawBatch = $cells["F"]
    $rawMRP = $cells["G"]
    $rawExpiry = $cells["H"]

    $cleanName = Clean-Text $rawName
    $cleanPack = Clean-Text $rawPack
    $cleanBatch = Clean-Text $rawBatch
    $stock = Clean-Pieces $rawPieces
    $mrp = Clean-MRP $rawMRP
    $expiry = Parse-ExpiryDate $rawExpiry

    # Compose full product name (e.g. "Sunline 100g")
    $displayName = $cleanName
    if (-not [string]::IsNullOrWhiteSpace($cleanPack) -and -not ($cleanName.ToLower().Contains($cleanPack.ToLower()))) {
        $displayName = "$cleanName $cleanPack"
    }

    # Determine unit
    $unit = "PACKET"
    $lowerPack = $cleanPack.ToLower()
    if ($lowerPack.Contains("ml") -or $lowerPack.Contains("lit") -or $lowerPack.Contains("ltr")) {
        $unit = "BOTTLE"
    } elseif ($lowerPack.Contains("kg")) {
        $unit = "PACKET"
    } elseif ($lowerPack.Contains("g") -or $lowerPack.Contains("gm")) {
        $unit = "PACKET"
    } else {
        $unit = "PCS"
    }

    $purchaseRate = [Math]::Round($mrp * 0.8, 2)
    $docId = "chem_prod_" + ($counter.ToString("000"))
    $barcode = "CHEM-" + ($counter.ToString("000"))
    $sku = "CHEM-" + ($counter.ToString("000"))

    $prod = [ordered]@{
        id = $docId
        productName = $displayName
        productNameLower = $displayName.ToLower()
        category = "chemical"
        brand = "Agri Chemical"
        hsnCode = "38089910"
        unit = $unit
        packSize = $cleanPack
        batchNo = $cleanBatch
        purchaseRate = $purchaseRate
        sellingRate = $mrp
        gstRate = 5
        openingStock = $stock
        currentStock = $stock
        minimumStock = 5
        expiryDate = $expiry
        barcode = $barcode
        sku = $sku
        status = "ACTIVE"
        sourcePage = $cells["A"]
        sourceSNo = $cells["B"]
    }

    $products += $prod
}

Write-Host "Processed $($products.Count) products."
$json = $products | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$PWD\chemical_products_prepared.json", $json, [System.Text.Encoding]::UTF8)
Write-Host "chemical_products_prepared.json successfully rewritten with ASCII/UTF-8 clean characters!"
