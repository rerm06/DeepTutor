import { Link } from "react-router-dom";
import { ErrorNote, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { localDay, money, usePortalApi } from "./api";
import { type PortalKey, usePortalT } from "./dict";
import "./portal.css";

/** Member portal "Documentos": signed agreements, consent status per channel/purpose, invoices. Read-only. */
export function DocumentsScreen() {
  const { t, lang } = usePortalT();
  const papi = usePortalApi();
  const res = useAsync(() => papi.documents(), [papi]);
  const d = res.data;
  const k = (key: string) => t(key as PortalKey);

  return (
    <div className="page">
      <h1 className="page__title">{t("documents.title")}</h1>
      <p className="lede">{t("documents.lede")}</p>
      {res.loading && !d ? <Loading /> : null}
      {res.error ? <ErrorNote code={res.error} onRetry={res.reload} /> : null}
      {d ? (
        <>
          <Section title={t("documents.agreements")}>
            {d.agreements.length === 0 ? (
              <p className="muted">{t("documents.noAgreements")}</p>
            ) : null}
            <ul className="portal-list">
              {d.agreements.map((a) => (
                <li key={a.id} className="portal-list__item">
                  <span className="portal-list__kind">
                    {a.title ?? k(`documents.kind.${a.kind}`)}
                  </span>
                  <span>{t("documents.version", { v: a.version })}</span>
                  <span className="muted">
                    {t("documents.signedOn", { date: formatDateTime(a.accepted_at, lang) })}{" "}
                    {k(`documents.source.${a.source}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section
            title={t("documents.consents")}
            actions={
              <Link className="btn" to="/me/consents" data-tour-id="portal-documents-consents">
                {t("documents.manageConsents")}
              </Link>
            }
          >
            {d.consents.length === 0 ? (
              <p className="muted">{t("documents.noConsents")}</p>
            ) : (
              <TableWrap label={t("documents.consents")}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t("documents.col.brand")}</th>
                      <th scope="col">{t("documents.col.channel")}</th>
                      <th scope="col">{t("documents.col.purpose")}</th>
                      <th scope="col">{t("documents.col.status")}</th>
                      <th scope="col">{t("documents.col.since")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.consents.map((c) => (
                      <tr key={c.id}>
                        <td>{c.brand_name}</td>
                        <td>{k(`documents.channel.${c.channel}`)}</td>
                        <td>{k(`documents.purpose.${c.purpose}`)}</td>
                        <td>
                          <Plate tone={c.status === "granted" ? "ok" : "neutral"}>
                            {k(`documents.status.${c.status}`)}
                          </Plate>
                        </td>
                        <td>{formatDateTime(c.since, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>
          <Section title={t("documents.invoices")}>
            {d.invoices.length === 0 ? (
              <p className="muted">{t("documents.noInvoices")}</p>
            ) : (
              <TableWrap label={t("documents.invoices")}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t("documents.col.number")}</th>
                      <th scope="col">{t("documents.col.date")}</th>
                      <th scope="col">{t("documents.col.total")}</th>
                      <th scope="col">{t("documents.col.status")}</th>
                      <th scope="col">{t("documents.col.link")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.invoices.map((i) => (
                      <tr key={i.id}>
                        <td>{i.number}</td>
                        <td>{localDay(i.issued_on, lang)}</td>
                        <td>{money(i.total_cents, lang)}</td>
                        <td>
                          <Plate
                            tone={
                              i.status === "paid" ? "ok" : i.status === "open" ? "warn" : "neutral"
                            }
                          >
                            {k(`documents.invoice.${i.status}`)}
                          </Plate>
                        </td>
                        <td>
                          <Link to={i.href} data-tour-id="portal-documents-invoice">
                            {t("documents.view", { n: i.number })}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
