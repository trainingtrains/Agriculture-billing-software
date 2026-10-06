$apiKey = "AIzaSyCbKhZw_ZSV4UNe7KkFoXxf_x03DcfvpRA"
$projectId = "billing-software-afec5"
$databaseId = "agri"

Write-Host "Authenticating to Firebase Auth as chem@agri.com..."
$authUrl = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$apiKey"
$authBody = @{
    email = "chem@agri.com"
    password = "Demo@123"
    returnSecureToken = $true
} | ConvertTo-Json

$authRes = Invoke-RestMethod -Uri $authUrl -Method Post -Body $authBody -ContentType "application/json"
$token = $authRes.idToken
$headers = @{
    "Authorization" = "Bearer $token"
}
Write-Host "Authenticated successfully! UID: $($authRes.localId)"

# Read prepared products
$productsRaw = Get-Content -Raw "chemical_products_prepared.json" | ConvertFrom-Json
Write-Host "Loaded $($productsRaw.Count) products to import."

$commitUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/$databaseId/documents:commit"

# Convert product object to Firestore document fields format
function To-FirestoreDocument($p) {
    $fields = [ordered]@{
        productName = @{ stringValue = [string]$p.productName }
        productNameLower = @{ stringValue = [string]$p.productNameLower }
        category = @{ stringValue = [string]$p.category }
        brand = @{ stringValue = [string]$p.brand }
        hsnCode = @{ stringValue = [string]$p.hsnCode }
        unit = @{ stringValue = [string]$p.unit }
        packSize = @{ stringValue = [string]$p.packSize }
        batchNo = @{ stringValue = [string]$p.batchNo }
        purchaseRate = @{ doubleValue = [double]$p.purchaseRate }
        sellingRate = @{ doubleValue = [double]$p.sellingRate }
        gstRate = @{ integerValue = [int]$p.gstRate }
        openingStock = @{ integerValue = [int]$p.openingStock }
        currentStock = @{ integerValue = [int]$p.currentStock }
        minimumStock = @{ integerValue = [int]$p.minimumStock }
        expiryDate = @{ stringValue = [string]$p.expiryDate }
        barcode = @{ stringValue = [string]$p.barcode }
        sku = @{ stringValue = [string]$p.sku }
        status = @{ stringValue = [string]$p.status }
        sourcePage = @{ stringValue = [string]$p.sourcePage }
        sourceSNo = @{ stringValue = [string]$p.sourceSNo }
    }
    return $fields
}

$batchSize = 50
$totalBatches = [Math]::Ceiling($productsRaw.Count / $batchSize)
Write-Host "Importing in $totalBatches batches of up to $batchSize items..."

$successCount = 0

for ($i = 0; $i -lt $productsRaw.Count; $i += $batchSize) {
    $batchItems = $productsRaw[$i..([Math]::Min($i + $batchSize - 1, $productsRaw.Count - 1))]
    $writes = @()
    
    foreach ($p in $batchItems) {
        $docPath = "projects/$projectId/databases/$databaseId/documents/products/$($p.id)"
        $docFields = To-FirestoreDocument $p
        $writes += @{
            update = @{
                name = $docPath
                fields = $docFields
            }
        }
    }

    $commitPayload = @{ writes = $writes } | ConvertTo-Json -Depth 10
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($commitPayload)

    try {
        $res = Invoke-RestMethod -Uri $commitUrl -Method Post -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8"
        $batchNum = [Math]::Floor($i / $batchSize) + 1
        $countInBatch = $batchItems.Count
        $successCount += $countInBatch
        Write-Host "Batch $batchNum / $totalBatches committed successfully ($countInBatch items). Total imported: $successCount"
    } catch {
        Write-Host "Batch failed at index $i : $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            Write-Host "Response: $($reader.ReadToEnd())"
        }
        break
    }
}

Write-Host "Import complete! Successfully imported $successCount out of $($productsRaw.Count) products into Firestore collection 'products'."

# Verify total count in Firestore
Write-Host "Verifying imported products in Firestore..."
$listUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/$databaseId/documents/products?pageSize=300"
$verifyRes = Invoke-RestMethod -Uri $listUrl -Method Get -Headers $headers
$totalInDb = if ($verifyRes.documents) { $verifyRes.documents.Count } else { 0 }
Write-Host "Total products verified in Firestore 'products' collection: $totalInDb"
if ($verifyRes.documents) {
    Write-Host "First 3 products:"
    foreach ($d in $verifyRes.documents | Select-Object -First 3) {
        $id = $d.name.Split('/')[-1]
        $name = $d.fields.productName.stringValue
        $stock = $d.fields.currentStock.integerValue
        $rate = $d.fields.sellingRate.doubleValue
        $exp = $d.fields.expiryDate.stringValue
        Write-Host "  - [$id] $name | Stock: $stock | MRP: Rs.$rate | Exp: $exp"
    }
    Write-Host "Last 3 products:"
    foreach ($d in $verifyRes.documents | Select-Object -Last 3) {
        $id = $d.name.Split('/')[-1]
        $name = $d.fields.productName.stringValue
        $stock = $d.fields.currentStock.integerValue
        $rate = $d.fields.sellingRate.doubleValue
        $exp = $d.fields.expiryDate.stringValue
        Write-Host "  - [$id] $name | Stock: $stock | MRP: Rs.$rate | Exp: $exp"
    }
}
