//go:build !windows

package sysmem

import (
	"os"
	"runtime"
	"strconv"
	"strings"
)

// Collect measures the resident memory of the current process on non-Windows platforms.
func Collect() Stats {
	if b, err := os.ReadFile("/proc/self/statm"); err == nil {
		fields := strings.Fields(string(b))
		if len(fields) >= 2 {
			if pages, err := strconv.ParseUint(fields[1], 10, 64); err == nil && pages > 0 {
				rss := pages * uint64(os.Getpagesize())
				return Stats{
					TotalBytes:   rss,
					AppBytes:     rss,
					ProcessCount: 1,
				}
			}
		}
	}
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return Stats{
		TotalBytes:   ms.Sys,
		AppBytes:     ms.Sys,
		ProcessCount: 1,
	}
}
