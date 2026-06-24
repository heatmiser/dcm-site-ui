import React, { useState } from "react";
import {
  Button,
  Card, CardHeader, CardTitle, CardBody,
  Drawer, DrawerActions, DrawerCloseButton, DrawerContent, DrawerContentBody,
  DrawerHead, DrawerPanelBody, DrawerPanelContent,
  Gallery, GalleryItem,
  Label,
  TextInput,
  Title,
} from "@patternfly/react-core";

const ROLES = [
  { value: "", label: "— unassigned —" },
  { value: "control-plane", label: "control-plane" },
  { value: "infra", label: "infra" },
  { value: "worker", label: "worker" },
  { value: "storage", label: "storage" },
];

function roleColor(role) {
  if (role === "control-plane") return "blue";
  if (role === "infra") return "purple";
  if (role === "worker") return "green";
  if (role === "storage") return "orange";
  return "grey";
}

function diskLabel(disk) {
  const gb = disk.size_gb ? `${disk.size_gb} GB` : "";
  const type = disk.rotational ? "HDD" : "SSD/NVMe";
  const model = disk.model ? ` ${disk.model}` : "";
  return `${disk.by_path || disk.name} (${gb} ${type}${model})`.trim();
}

function HardwarePanel({ node, onClose }) {
  const m = node?.manifest || {};
  return (
    <DrawerPanelContent style={{ minWidth: "360px" }}>
      <DrawerHead>
        <Title headingLevel="h3" size="md">
          {node ? `${m.system?.manufacturer || ""} ${m.system?.model || ""}`.trim() : ""}
        </Title>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerPanelBody>
        {node && (
          <dl style={{ fontSize: "0.875rem", lineHeight: 1.8, margin: 0 }}>
            <dt style={{ fontWeight: 600 }}>Serial</dt>
            <dd style={{ fontFamily: "monospace", marginBottom: "0.75rem", marginLeft: 0 }}>
              {node.serial}
            </dd>

            <dt style={{ fontWeight: 600 }}>CPU</dt>
            <dd style={{ marginBottom: "0.75rem", marginLeft: 0 }}>
              {m.cpu?.count} cores — {m.cpu?.model}
            </dd>

            <dt style={{ fontWeight: 600 }}>Memory</dt>
            <dd style={{ marginBottom: "0.75rem", marginLeft: 0 }}>{m.memory_gb} GB</dd>

            {m.system?.bios_version && (
              <>
                <dt style={{ fontWeight: 600 }}>BIOS</dt>
                <dd style={{ marginBottom: "0.75rem", marginLeft: 0 }}>{m.system.bios_version}</dd>
              </>
            )}

            <dt style={{ fontWeight: 600 }}>NICs ({m.interfaces?.length || 0})</dt>
            <dd style={{ marginBottom: "0.75rem", marginLeft: 0 }}>
              {(m.interfaces || []).map(ifc => (
                <div key={ifc.name} style={{ marginBottom: "0.25rem" }}>
                  <strong>{ifc.name}</strong>{" "}
                  <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{ifc.mac}</span>{" "}
                  <span style={{ color: ifc.state === "up" ? "#3e8635" : "#6a6e73" }}>
                    {ifc.state}
                  </span>
                  {ifc.speed ? ` ${ifc.speed} Mbps` : ""}
                </div>
              ))}
            </dd>

            <dt style={{ fontWeight: 600 }}>Disks ({m.disks?.length || 0})</dt>
            <dd style={{ marginBottom: "0.75rem", marginLeft: 0 }}>
              {(m.disks || []).map((d, i) => (
                <div key={i} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {d.by_path || d.name}
                  </div>
                  <div style={{ color: "#6a6e73", fontSize: "0.8rem" }}>
                    {d.size_gb} GB · {d.rotational ? "HDD" : "SSD/NVMe"} · {d.model || ""}
                  </div>
                </div>
              ))}
            </dd>

            {m.gpu && m.gpu.length > 0 && (
              <>
                <dt style={{ fontWeight: 600 }}>GPU</dt>
                <dd style={{ marginLeft: 0 }}>
                  {m.gpu.map((g, i) => (
                    <div key={i}>{g.count}× {g.vendor} {g.model}</div>
                  ))}
                </dd>
              </>
            )}
          </dl>
        )}
      </DrawerPanelBody>
    </DrawerPanelContent>
  );
}

function NodeCard({ node, sel, onSelect, onViewHardware }) {
  const m = node.manifest || {};
  const upIfaces = (m.interfaces || []).filter(i => i.state === "up");
  const allIfaces = m.interfaces || [];
  const ifaceList = upIfaces.length > 0 ? upIfaces : allIfaces;
  const disks = m.disks || [];

  return (
    <Card isFullHeight>
      <CardHeader>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
          <div>
            <CardTitle style={{ fontSize: "0.95rem" }}>
              {m.system?.manufacturer} {m.system?.model}
            </CardTitle>
            <div style={{ fontSize: "0.75rem", color: "#6a6e73", fontFamily: "monospace" }}>
              {node.ip}
            </div>
          </div>
          {sel?.role && (
            <Label color={roleColor(sel.role)} style={{ marginLeft: "0.5rem", flexShrink: 0 }}>
              {sel.role}
            </Label>
          )}
        </div>
      </CardHeader>
      <CardBody>
        <div style={{ fontSize: "0.8rem", color: "#6a6e73", marginBottom: "0.75rem" }}>
          {m.cpu?.count}c · {m.memory_gb} GB
          {m.gpu?.length > 0 ? ` · ${m.gpu.length} GPU` : ""}
          {" · "}{disks.length} disk{disks.length !== 1 ? "s" : ""}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
              Role
            </label>
            <select
              className="pf-v5-c-form-control"
              value={sel?.role || ""}
              onChange={e => onSelect(node.id, "role", e.target.value)}
              style={{ width: "100%" }}
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
              Hostname
            </label>
            <TextInput
              value={sel?.hostname || ""}
              onChange={(_, value) => onSelect(node.id, "hostname", value)}
              placeholder="cp1.cluster.example.com"
              type="text"
            />
          </div>

          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
              Primary NIC
            </label>
            <select
              className="pf-v5-c-form-control"
              value={sel?.interface_selected || ""}
              onChange={e => onSelect(node.id, "interface_selected", e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">— select interface —</option>
              {ifaceList.map(ifc => (
                <option key={ifc.name} value={ifc.name}>
                  {ifc.name} ({ifc.mac}{ifc.speed ? ` ${ifc.speed}Mbps` : ""})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
              Boot Disk
            </label>
            <select
              className="pf-v5-c-form-control"
              value={sel?.disk_selected || ""}
              onChange={e => onSelect(node.id, "disk_selected", e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">— select disk —</option>
              {disks.map((d, i) => (
                <option key={i} value={d.by_path || d.name}>
                  {diskLabel(d)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: "0.75rem" }}>
          <Button variant="link" isInline onClick={() => onViewHardware(node)}>
            View hardware details
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default function ClassifyView({ nodes, selections, onSelect, onClassify, onReset }) {
  const [drawerNode, setDrawerNode] = useState(null);

  if (nodes.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#6a6e73" }}>
        No nodes to classify. Return to Discovery and wait for nodes to phone home.
      </div>
    );
  }

  const assignedCount = Object.values(selections).filter(s => s.role && s.hostname).length;

  return (
    <Drawer isExpanded={!!drawerNode} position="right">
      <DrawerContent panelContent={
        <HardwarePanel node={drawerNode} onClose={() => setDrawerNode(null)} />
      }>
        <DrawerContentBody>
          <div style={{
            marginBottom: "1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span style={{ color: "#6a6e73", fontSize: "0.875rem" }}>
              {assignedCount} of {nodes.length} nodes assigned
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {nodes.some(n => n.role) && (
                <Button variant="secondary" onClick={onReset}>
                  Reset All
                </Button>
              )}
              <Button
                variant="primary"
                onClick={onClassify}
                isDisabled={assignedCount === 0}
              >
                Submit Classification
              </Button>
            </div>
          </div>

          <Gallery hasGutter minWidths={{ default: "300px" }}>
            {nodes.map(node => (
              <GalleryItem key={node.id}>
                <NodeCard
                  node={node}
                  sel={selections[node.id]}
                  onSelect={onSelect}
                  onViewHardware={setDrawerNode}
                />
              </GalleryItem>
            ))}
          </Gallery>
        </DrawerContentBody>
      </DrawerContent>
    </Drawer>
  );
}
