$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$profile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'direct-file-profile'))
$downloads = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'direct-file-downloads'))
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$port = 9337
$page = 'file:///' + (($root + '\BMX_STREET_SLIDE_V0.9.0_TEST.html') -replace '\\','/')

if (-not $profile.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Profile path escaped project' }
if (-not $downloads.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Download path escaped project' }
if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
if (Test-Path -LiteralPath $downloads) { Remove-Item -LiteralPath $downloads -Recurse -Force }
New-Item -ItemType Directory -Path $profile | Out-Null
New-Item -ItemType Directory -Path $downloads | Out-Null
$arguments = @('--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--enable-unsafe-swiftshader','--allow-file-access-from-files',"--remote-debugging-port=$port",
  '--remote-allow-origins=*',
  "--user-data-dir=$profile",$page)
$process = Start-Process -FilePath $chrome -ArgumentList $arguments -WindowStyle Hidden -PassThru

function Wait-Endpoint {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    try {
      $targets = Invoke-RestMethod "http://127.0.0.1:$port/json/list"
      foreach ($target in $targets) {
        if ([string]$target.type -eq 'page' -and [string]$target.url -like 'file:*BMX_STREET_SLIDE_V0.9.0_TEST.html*') {
          return [string]$target.webSocketDebuggerUrl
        }
      }
    } catch {}
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw 'Chrome DevTools endpoint did not start'
}

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.Options.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy()
$nextId = 0
function Invoke-Cdp([string]$method,[hashtable]$params) {
  $script:nextId++
  $payload = @{id=$script:nextId;method=$method;params=$params} | ConvertTo-Json -Compress -Depth 8
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  do {
    $stream = [IO.MemoryStream]::new()
    do {
      $buffer = [byte[]]::new(65536)
      $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),[Threading.CancellationToken]::None).GetAwaiter().GetResult()
      $stream.Write($buffer,0,$received.Count)
    } while (-not $received.EndOfMessage)
    $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
  } while ($message.id -ne $script:nextId)
  if ($message.error) { throw ($message.error | ConvertTo-Json -Compress) }
  return $message.result
}

function Evaluate([string]$expression) {
  $result = Invoke-Cdp 'Runtime.evaluate' @{expression=$expression;returnByValue=$true;awaitPromise=$true}
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Compress -Depth 8) }
  return $result.result.value
}

function Wait-Expression([string]$expression,[int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    if (Evaluate $expression) { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  $status = Evaluate "document.getElementById('error')?.textContent"
  throw "Timeout waiting for: $expression; status: $status"
}

try {
  $webSocketUrl = ([string](Wait-Endpoint)).Replace('localhost','127.0.0.1')
  Write-Output "DevTools: $webSocketUrl"
  $socket.ConnectAsync([Uri]$webSocketUrl,[Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  Invoke-Cdp 'Runtime.enable' @{} | Out-Null
  Invoke-Cdp 'Browser.setDownloadBehavior' @{behavior='allow';downloadPath=$downloads;eventsEnabled=$true} | Out-Null
  Write-Output ('Page: ' + (Evaluate "JSON.stringify({url:location.href,title:document.title,ready:document.readyState,body:document.body?.textContent.length,error:document.getElementById('error')?.textContent})"))
  Wait-Expression "document.getElementById('export')?.disabled===false" 180
  $initial = Evaluate "document.getElementById('error').textContent"
  Evaluate "(()=>{document.getElementById('export').click();return true})()" | Out-Null
  Wait-Expression "document.getElementById('export')?.disabled===false && document.getElementById('canvas')?.dataset.geometry==='cad'" 180
  Evaluate "(()=>{document.getElementById('export').click();return true})()" | Out-Null
  $downloaded = Join-Path $downloads 'BMX_STREET_SLIDE_V0.9.0.stl'
  $downloadDeadline = (Get-Date).AddSeconds(20)
  while ((-not (Test-Path -LiteralPath $downloaded)) -and (Get-Date) -lt $downloadDeadline) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path -LiteralPath $downloaded)) { throw 'STL download did not create a file' }
  $downloadBytes = (Get-Item -LiteralPath $downloaded).Length
  if ($downloadBytes -le 84) { throw "Downloaded STL is too small: $downloadBytes" }
  Evaluate "(()=>{const e=document.getElementById('headD');e.value='31';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()" | Out-Null
  Wait-Expression "document.getElementById('canvas')?.dataset.geometry==='preview'" 10
  Evaluate "(()=>{document.getElementById('export').click();return true})()" | Out-Null
  Wait-Expression "document.getElementById('export')?.disabled===false && document.getElementById('canvas')?.dataset.geometry==='cad'" 180
  $changed = Evaluate "JSON.stringify({status:document.getElementById('error').textContent,headD:document.getElementById('headDv').textContent,geometry:document.getElementById('canvas').dataset.geometry})"
  Write-Output "Initial: $initial"
  Write-Output "Downloaded STL: $downloadBytes bytes"
  Write-Output "After change: $changed"
} finally {
  try { $socket.Dispose() } catch {}
  & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 500
  if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $downloads) { Remove-Item -LiteralPath $downloads -Recurse -Force -ErrorAction SilentlyContinue }
}
