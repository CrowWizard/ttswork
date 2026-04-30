export function buildPagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function buildPaginatedResponse<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    pagination: buildPagination(page, pageSize, total),
  };
}
