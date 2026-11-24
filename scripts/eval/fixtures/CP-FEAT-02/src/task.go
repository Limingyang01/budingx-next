package task

import (
	"context"
	"errors"
)

// TODO: 实现可取消的长任务接口，见 task_spec.md。
func Run(ctx context.Context, n int) (int, error) {
	return 0, errors.New("not implemented")
}
