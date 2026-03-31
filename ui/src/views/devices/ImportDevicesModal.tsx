import { useState } from "react";

import { Modal, Upload, Space, Typography, Button, message } from "antd";
import { InboxOutlined, DownloadOutlined } from "@ant-design/icons";
import fileDownload from "js-file-download";

import {
  CreateDeviceRequest,
  Device,
  CreateDeviceKeysRequest,
  DeviceKeys,
} from "@chirpstack/chirpstack-api-grpc-web/api/device_pb";

import DeviceStore from "../../stores/DeviceStore";
import SessionStore from "../../stores/SessionStore";

const TEMPLATE_CSV =
  "name,description,devEUI,joinEui,appKey,deviceProfileId\n" +
  "Sensor_01,Test location,1122334455667788,0000000000000000,00112233445566778899aabbccddeeff,replace-with-real-profile-id";

interface IProps {
  open: boolean;
  applicationId: string;
  onCancel: () => void;
  onUpload: () => void;
}

interface CsvRow {
  name: string;
  description: string;
  devEUI: string;
  joinEui: string;
  appKey: string;
  deviceProfileId: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim());
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(",").map(v => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row as unknown as CsvRow);
  }

  return rows;
}

function importRowAsync(row: CsvRow, applicationId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const device = new Device();
    device.setApplicationId(applicationId);
    device.setDevEui(row.devEUI);
    device.setName(row.name);
    device.setDescription(row.description);
    device.setJoinEui(row.joinEui);
    device.setDeviceProfileId(row.deviceProfileId);

    const createReq = new CreateDeviceRequest();
    createReq.setDevice(device);

    DeviceStore.client.create(createReq, SessionStore.getMetadata(), err => {
      if (err !== null) {
        reject(new Error(`[${row.devEUI}] Create failed: ${err.message}`));
        return;
      }

      const dk = new DeviceKeys();
      dk.setDevEui(row.devEUI);
      dk.setNwkKey(row.appKey);

      const keysReq = new CreateDeviceKeysRequest();
      keysReq.setDeviceKeys(dk);

      DeviceStore.client.createKeys(keysReq, SessionStore.getMetadata(), err => {
        if (err !== null) {
          reject(new Error(`[${row.devEUI}] Set keys failed: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  });
}

function ImportDevicesModal(props: IProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleDownloadTemplate = () => {
    fileDownload(TEMPLATE_CSV, "template.csv", "text/csv");
  };

  const handleOk = async () => {
    if (!selectedFile) return;

    const text = await selectedFile.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      message.error("No valid rows found in the CSV file.");
      return;
    }

    setLoading(true);

    let successCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        await importRowAsync(row, props.applicationId);
        successCount++;
      } catch (e: unknown) {
        errors.push((e as Error).message);
      }
    }

    setLoading(false);
    setSelectedFile(null);

    if (errors.length === 0) {
      message.success(`Successfully imported ${successCount} device(s).`);
    } else {
      message.error(
        `Imported ${successCount} device(s), ${errors.length} failed. First error: ${errors[0]}`,
        6,
      );
    }

    props.onUpload();
  };

  const handleCancel = () => {
    setSelectedFile(null);
    props.onCancel();
  };

  return (
    <Modal
      title="Import Devices (CSV)"
      open={props.open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="Upload"
      okButtonProps={{ disabled: selectedFile === null }}
      afterClose={() => setSelectedFile(null)}
    >
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Space align="center">
          <Typography.Text type="secondary">Bulk-import devices from a CSV file.</Typography.Text>
          <Button type="link" icon={<DownloadOutlined />} onClick={handleDownloadTemplate} style={{ padding: 0 }}>
            Download CSV template
          </Button>
        </Space>
        <Upload.Dragger
          accept=".csv"
          maxCount={1}
          beforeUpload={file => {
            setSelectedFile(file);
            return false;
          }}
          onRemove={() => setSelectedFile(null)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Click or drag a CSV file here to select it</p>
          <p className="ant-upload-hint">Required columns: name, description, devEUI, joinEui, appKey, deviceProfileId</p>
        </Upload.Dragger>
      </Space>
    </Modal>
  );
}

export default ImportDevicesModal;
