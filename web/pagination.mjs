import { $t } from "../client/i18n.mjs";
export const PAGE_SIZE = 20;

export function paginate(items, requestedPage = 1) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1));
  return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, totalPages, total: items.length };
}

const PAGINATION_UNITS = { 'automation-triggers': $t("轮") };

export function paginationMarkup({ page, totalPages, total }, key) {
  if (totalPages <= 1) return "";
  const unit = PAGINATION_UNITS[key] || $t("条");
  return `<nav class="list-pagination" aria-label="${$t("列表分页")}" data-pagination="${key}"><span>${$t("共 {0} {1} · 每页 {2} {3}", [total, unit, PAGE_SIZE, unit])}</span><div><button type="button" class="small-button" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>${$t("上一页")}</button><span class="list-pagination-page">${page} / ${totalPages}</span><button type="button" class="small-button" data-page="${page + 1}" ${page === totalPages ? "disabled" : ""}>${$t("下一页")}</button></div></nav>`;
}
