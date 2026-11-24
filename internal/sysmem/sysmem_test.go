package sysmem

import "testing"

func TestCollectReturnsNonZeroMemory(t *testing.T) {
	stats := Collect()
	if stats.ProcessCount < 1 {
		t.Fatalf("expected at least 1 process, got %d", stats.ProcessCount)
	}
	if stats.AppBytes == 0 || stats.TotalBytes < stats.AppBytes {
		t.Fatalf("unexpected memory stats: %+v", stats)
	}
}
