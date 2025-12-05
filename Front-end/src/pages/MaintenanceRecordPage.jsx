import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Spinner,
  Table
} from "react-bootstrap";
import {
  fetchMaintenanceDraft,
  fetchMaintenanceHistory,
  fetchMaintenanceRecord,
  saveMaintenanceRecord
} from "../api/maintenanceRecords";
import { getImageUrl } from "../utils/config";
import { PanZoomContainFrame } from "./previewPage";
import "../styles/maintenanceRecord.css";

const STATUS_OPTIONS = ["OK", "Needs Maintenance", "Urgent Attention"];

const DEFAULT_ENGINEER_FIELDS = {
  inspectorName: "",
  inspectionDate: "",
  status: "OK",
  voltage: "",
  current: "",
  recommendedAction: "",
  correctiveAction: "",
  additionalRemarks: "",
  followUpDate: ""
};

const DEFAULT_CONTAINER_HEIGHT = 420;

const formatDateTime = (value) => {
  if (!value) {
    return "—";
  }
  try {
    const date = new Date(value);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (error) {
    return value;
  }
};

const formatDate = (value) => {
  if (!value) {
    return "";
  }
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch (error) {
    return value;
  }
};

const resolveImageUrl = (image) => {
  if (!image) {
    return "";
  }
  const candidates = [
    image.url,
    image.fileUrl,
    image.publicUrl,
    image.filePath,
    image.path,
    image.fileName,
    image.name
  ].filter(Boolean);

  if (!candidates.length) {
    return "";
  }

  const candidate = String(candidates[0]);
  return candidate.startsWith("http") ? candidate : getImageUrl(candidate);
};

const ensureEngineerFields = (payload) => ({
  ...DEFAULT_ENGINEER_FIELDS,
  ...(payload || {})
});

const buildAnomalyNotes = (anomalies = []) => {
  return anomalies.reduce((acc, anomaly) => {
    const key = anomaly?.id ?? anomaly?.anomalyId;
    if (!key) {
      return acc;
    }
    acc[key] = anomaly?.note || anomaly?.engineerNote || "";
    return acc;
  }, {});
};

const severityVariant = (severity) => {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "warning";
    case "LOW":
      return "success";
    default:
      return "secondary";
  }
};

const statusVariant = (status) => {
  switch ((status || "").toUpperCase()) {
    case "OK":
      return "success";
    case "NEEDS MAINTENANCE":
      return "warning";
    case "URGENT ATTENTION":
      return "danger";
    default:
      return "secondary";
  }
};

export default function MaintenanceRecordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recordId } = useParams();

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const transformerIdFromParams = searchParams.get("transformerId") || location.state?.transformerId;
  const inspectionIdFromParams = searchParams.get("inspectionId") || location.state?.inspectionId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [record, setRecord] = useState(null);
  const [engineerFields, setEngineerFields] = useState(DEFAULT_ENGINEER_FIELDS);
  const [anomalyNotes, setAnomalyNotes] = useState({});
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [resetTrigger, setResetTrigger] = useState(0);

  const transformerId = record?.transformer?.id || transformerIdFromParams;
  const inspectionId = record?.inspection?.id || inspectionIdFromParams;

  useEffect(() => {
    let cancelled = false;

    async function loadRecord() {
      if (!recordId && !transformerIdFromParams) {
        setError("Transformer id is required to generate a maintenance record");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = recordId
          ? await fetchMaintenanceRecord(recordId)
          : await fetchMaintenanceDraft(transformerIdFromParams, inspectionIdFromParams);

        if (cancelled) {
          return;
        }

        setRecord(data);
        const mergedFields = ensureEngineerFields(data?.engineerFields);
        if (!mergedFields.inspectionDate) {
          mergedFields.inspectionDate = data?.inspection?.timestamp
            || data?.inspection?.inspectedAt
            || new Date().toISOString();
        }
        setEngineerFields(mergedFields);
        setAnomalyNotes(buildAnomalyNotes(data?.anomalies));
        setLastSavedAt(data?.updatedAt || data?.createdAt || null);
        if (Array.isArray(data?.history)) {
          setHistory(data.history);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load maintenance record");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadRecord();

    return () => {
      cancelled = true;
    };
  }, [recordId, transformerIdFromParams, inspectionIdFromParams]);

  useEffect(() => {
    if (!transformerId) {
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const data = await fetchMaintenanceHistory(transformerId);
        if (!cancelled) {
          setHistory(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err.message || "Failed to load history");
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [transformerId, record?.id]);

  const maintenanceImageUrl = useMemo(() => resolveImageUrl(record?.maintenanceImage), [record]);

  const handleFieldChange = useCallback((field, value) => {
    setEngineerFields((prev) => ({
      ...prev,
      [field]: value
    }));
  }, []);

  const handleAnomalyNoteChange = useCallback((id, value) => {
    setAnomalyNotes((prev) => ({
      ...prev,
      [id]: value
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!transformerId) {
      setError("Cannot save record without a transformer id");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        id: record?.id,
        version: record?.version,
        transformerId,
        inspectionId,
        maintenanceImageId: record?.maintenanceImage?.id,
        engineerFields,
        anomalyNotes,
      };

      const saved = await saveMaintenanceRecord(payload);
      setRecord(saved);
      setEngineerFields(ensureEngineerFields(saved?.engineerFields));
      setAnomalyNotes(buildAnomalyNotes(saved?.anomalies));
      setLastSavedAt(saved?.updatedAt || new Date().toISOString());
      if (Array.isArray(saved?.history)) {
        setHistory(saved.history);
      }

      if (saved?.id && String(saved.id) !== String(recordId || "")) {
        navigate(`/maintenance-records/${saved.id}`, {
          replace: true,
          state: {
            transformerId,
            inspectionId,
          },
        });
      }
    } catch (err) {
      setError(err.message || "Failed to save maintenance record");
    } finally {
      setSaving(false);
    }
  }, [transformerId, inspectionId, engineerFields, anomalyNotes, record, recordId, navigate]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleHistoryView = useCallback((entry) => {
    if (!entry || !entry.id) {
      return;
    }

    if (recordId && String(entry.id) === String(recordId)) {
      return;
    }

    navigate(`/maintenance-records/${entry.id}`, {
      state: {
        transformerId,
        inspectionId: entry.inspectionId || inspectionId,
      },
    });
  }, [navigate, recordId, transformerId, inspectionId]);

  const transformerMeta = record?.transformer || {};
  const inspectionMeta = record?.inspection || {};

  const anomalyRows = record?.anomalies || [];

  const printReadyHint = useMemo(() => {
    if (!lastSavedAt) {
      return "";
    }
    return `Last saved ${formatDateTime(lastSavedAt)}`;
  }, [lastSavedAt]);

  return (
    <div className="maintenance-record-page">
      {/* Print header (visible only when printing) */}
      <div className="print-only">
        <div className="d-flex justify-content-between align-items-start mb-3">
          <div>
            <h1 className="fw-bold" style={{ fontSize: "1.6rem", margin: 0 }}>Maintenance Record</h1>
            <div className="text-muted">Generated: {formatDateTime(new Date().toISOString())}</div>
          </div>
          <div className="text-end">
            <div className="fw-semibold">Transformer: {transformerMeta.transformerNo || "—"}</div>
            <div>Inspection No: {inspectionMeta.inspectionNo || "—"}</div>
          </div>
        </div>
        <div className="meta-grid mb-3">
          <MetaItem label="Transformer No" value={transformerMeta.transformerNo || "—"} />
          <MetaItem label="Pole No" value={transformerMeta.pole_no || "—"} />
          <MetaItem label="Region" value={transformerMeta.region || "—"} />
          <MetaItem label="Inspected By" value={inspectionMeta.inspectedBy || "—"} />
          <MetaItem label="Inspection No" value={inspectionMeta.inspectionNo || "—"} />
          <MetaItem label="Inspection Timestamp" value={formatDateTime(inspectionMeta.inspectedDate || inspectionMeta.timestamp || inspectionMeta.inspectedAt)} />
        </div>
        <hr />
      </div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div>
          <h2 className="fw-semibold mb-1">Maintenance Record</h2>
          <div className="text-muted small">{printReadyHint || "Draft not yet saved"}</div>
        </div>
        <div className="actions-bar print-hidden screen-only">
          <Button
            variant="outline-secondary"
            onClick={() => navigate(-1)}
          >
            <i className="bi bi-arrow-left me-2" />Back
          </Button>
          <Button
            variant="outline-secondary"
            onClick={() => setResetTrigger((prev) => prev + 1)}
            disabled={!maintenanceImageUrl}
          >
            <i className="bi bi-arrow-clockwise me-2" />Reset View
          </Button>
          <Button
            variant="outline-secondary"
            onClick={handlePrint}
          >
            <i className="bi bi-printer me-2" />Print / Export
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <>
                <Spinner
                  animation="border"
                  size="sm"
                  role="status"
                  className="me-2"
                />Saving...
              </>
            ) : (
              <>
                <i className="bi bi-save me-2" />Save Record
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-0">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="d-flex align-items-center justify-content-center" style={{ minHeight: 320 }}>
          <Spinner animation="border" role="status" className="me-3" />
          <span className="text-muted">Loading maintenance record...</span>
        </div>
      ) : (
        <>
          <Card className="record-card border-0">
            <Card.Body>
              <div className="d-flex flex-column gap-3">
                <div className="d-flex flex-column flex-lg-row gap-4">
                  <div className="flex-grow-1">
                    <div className="section-heading mb-3">Metadata</div>
                    <div className="meta-grid">
                      <MetaItem label="Transformer No" value={transformerMeta.transformerNo || "—"} />
                      <MetaItem label="Pole No" value={transformerMeta.pole_no || "—"} />
                      <MetaItem label="Region" value={transformerMeta.region || "—"} />
                      <MetaItem label="Inspected By" value={inspectionMeta.inspectedBy || "—"} />
                      <MetaItem label="Inspection No" value={inspectionMeta.inspectionNo || "—"} />
                      <MetaItem label="Inspection Timestamp" value={formatDateTime(inspectionMeta.inspectedDate || inspectionMeta.timestamp || inspectionMeta.inspectedAt)} />
                    </div>
                  </div>
                  <div className="flex-grow-1">
                    <div className="section-heading mb-3">Thermal Snapshot</div>
                    {maintenanceImageUrl ? (
                      <div className="print-avoid-break">
                        <PanZoomContainFrame
                          src={maintenanceImageUrl}
                          label="Maintenance Image"
                          metaText={formatDateTime(record?.maintenanceImage?.capturedAt || record?.maintenanceImage?.uploadDate)}
                          containerHeight={DEFAULT_CONTAINER_HEIGHT}
                          syncZoomOn={false}
                          isHoveringSync={false}
                          onSyncEnter={undefined}
                          onSyncLeave={undefined}
                          onSyncMove={undefined}
                          resetTrigger={resetTrigger}
                          annotationTool="move"
                          annotations={anomalyRows}
                          imageId={record?.maintenanceImage?.id}
                        />
                      </div>
                    ) : (
                      <div className="d-flex flex-column align-items-center justify-content-center border rounded-4 p-4 bg-light text-muted" style={{ minHeight: DEFAULT_CONTAINER_HEIGHT }}>
                        <i className="bi bi-image fs-1 mb-2" />
                        <div>No maintenance image available</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card.Body>
          </Card>

          <Card className="record-card border-0">
            <Card.Body>
              <div className="section-heading mb-3">Detected Anomalies</div>
              {anomalyRows.length === 0 ? (
                <div className="text-muted">No anomalies were detected for this inspection.</div>
              ) : (
                <Table responsive hover className="align-middle">
                  <thead>
                    <tr className="text-muted">
                      <th>Severity</th>
                      <th>Type</th>
                      <th>Confidence</th>
                      <th>Location</th>
                      <th className="w-50">Engineer Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomalyRows.map((anomaly, index) => {
                      const key = anomaly?.id ?? anomaly?.anomalyId ?? `anomaly-${index}`;
                      const confidence = typeof anomaly?.confidence === "number"
                        ? `${Math.round(anomaly.confidence * 100)}%`
                        : anomaly?.confidenceLabel || "—";
                      const locationLabel = anomaly?.location || anomaly?.region || formatBoundingBox(anomaly?.boundingBox);
                      return (
                        <tr key={key}>
                          <td>
                            <Badge bg={severityVariant(anomaly?.severityLevel)}>
                              {anomaly?.severityLevel || "Unknown"}
                            </Badge>
                          </td>
                          <td>{anomaly?.errorType || anomaly?.category || "—"}</td>
                          <td>{confidence}</td>
                          <td>{locationLabel || "—"}</td>
                          <td>
                            <Form.Control
                              as="textarea"
                              rows={3}
                              className="anomaly-notes"
                              value={anomalyNotes[key] || ""}
                              onChange={(event) => handleAnomalyNoteChange(key, event.target.value)}
                              placeholder="Add notes, corrective actions, or follow-up steps"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>

          <div className="engineer-section">
            <div className="section-heading mb-3">Engineer Inputs</div>
            <Row className="g-3">
              <Col md={4}>
                <Form.Group controlId="inspectorName">
                  <Form.Label>Inspector Name</Form.Label>
                  <Form.Control
                    type="text"
                    value={engineerFields.inspectorName}
                    onChange={(event) => handleFieldChange("inspectorName", event.target.value)}
                    placeholder="Enter inspector name"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="inspectionDate">
                  <Form.Label>Inspection Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={formatDate(engineerFields.inspectionDate) || formatDate(inspectionMeta.timestamp)}
                    onChange={(event) => handleFieldChange("inspectionDate", event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="status">
                  <Form.Label>Status</Form.Label>
                  <Form.Select
                    value={engineerFields.status}
                    onChange={(event) => handleFieldChange("status", event.target.value)}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3 mt-1">
              <Col md={4}>
                <Form.Group controlId="voltage">
                  <Form.Label>Voltage (kV)</Form.Label>
                  <Form.Control
                    type="text"
                    value={engineerFields.voltage}
                    onChange={(event) => handleFieldChange("voltage", event.target.value)}
                    placeholder="e.g., 33"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="current">
                  <Form.Label>Current (A)</Form.Label>
                  <Form.Control
                    type="text"
                    value={engineerFields.current}
                    onChange={(event) => handleFieldChange("current", event.target.value)}
                    placeholder="e.g., 120"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="followUpDate">
                  <Form.Label>Follow-up Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={formatDate(engineerFields.followUpDate)}
                    onChange={(event) => handleFieldChange("followUpDate", event.target.value)}
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3 mt-1">
              <Col md={6}>
                <Form.Group controlId="recommendedAction">
                  <Form.Label>Recommended Action</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={engineerFields.recommendedAction}
                    onChange={(event) => handleFieldChange("recommendedAction", event.target.value)}
                    placeholder="Document the recommended actions based on the anomalies"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="correctiveAction">
                  <Form.Label>Corrective Actions Planned / Taken</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={engineerFields.correctiveAction}
                    onChange={(event) => handleFieldChange("correctiveAction", event.target.value)}
                    placeholder="Describe the corrective measures or planned maintenance"
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3 mt-1">
              <Col>
                <Form.Group controlId="additionalRemarks">
                  <Form.Label>Additional Remarks</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={engineerFields.additionalRemarks}
                    onChange={(event) => handleFieldChange("additionalRemarks", event.target.value)}
                    placeholder="Capture any additional context for auditors or future inspections"
                  />
                </Form.Group>
                <div className="print-hint mt-2">Editable fields are grouped for clarity and print formatting.</div>
              </Col>
            </Row>
          </div>

          <Card className="record-card border-0 print-hidden">
            <Card.Body>
              <div className="section-heading mb-3">Record History</div>
              {historyLoading ? (
                <div className="d-flex align-items-center text-muted">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Loading history...
                </div>
              ) : historyError ? (
                <Alert variant="warning" className="mb-0">
                  {historyError}
                </Alert>
              ) : history.length === 0 ? (
                <div className="text-muted">No previous maintenance records found for this transformer.</div>
              ) : (
                <Table striped hover responsive className="history-table align-middle">
                  <thead className="text-muted">
                    <tr>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Inspector</th>
                      <th>Inspection Date</th>
                      <th>Saved On</th>
                      <th aria-label="History actions"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.version ?? "—"}</td>
                        <td>
                          <Badge bg={statusVariant(entry.status)}>{entry.status || "—"}</Badge>
                        </td>
                        <td>{entry.inspectorName || entry.createdBy || "—"}</td>
                        <td>{formatDateTime(entry.inspectionDate)}</td>
                        <td>{formatDateTime(entry.updatedAt || entry.createdAt)}</td>
                        <td className="text-end">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => handleHistoryView(entry)}
                          >
                            <i className="bi bi-eye me-1" />View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="meta-item">
      <div className="meta-label">{label}</div>
      <div className="meta-value">{value || "—"}</div>
    </div>
  );
}

function formatBoundingBox(box) {
  if (!box) {
    return "";
  }
  const { x1, y1, x2, y2 } = box;
  const values = [x1, y1, x2, y2].map((value) => Number(value));
  if (values.some((value) => Number.isNaN(value))) {
    return "";
  }
  const [nx1, ny1, nx2, ny2] = values;
  return `x:${nx1.toFixed(0)}-${nx2.toFixed(0)}, y:${ny1.toFixed(0)}-${ny2.toFixed(0)}`;
}
