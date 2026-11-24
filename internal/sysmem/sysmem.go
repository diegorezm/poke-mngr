package sysmem

// Stats represents process memory consumption for the desktop application and its child processes (e.g. WebView2).
type Stats struct {
	TotalBytes   uint64 `json:"totalBytes"`
	AppBytes     uint64 `json:"appBytes"`
	WebViewBytes uint64 `json:"webViewBytes"`
	ProcessCount int    `json:"processCount"`
}
