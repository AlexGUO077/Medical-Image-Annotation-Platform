import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { CaseProcessingResult, ZipInspectionResult } from './cases-import.models';

interface WorkerRequest {
  operation: 'inspect_zip' | 'process_case';
  [key: string]: unknown;
}

interface WorkerResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code?: string; message?: string };
}

@Injectable()
export class DeidWorkerService {
  async inspectZip(zipPath: string, outputPath: string): Promise<ZipInspectionResult> {
    return this.run<ZipInspectionResult>({ operation: 'inspect_zip', zip_path: zipPath, output_path: outputPath }, 120_000);
  }

  async processCase(casePath: string, outputPath: string): Promise<CaseProcessingResult> {
    return this.run<CaseProcessingResult>({ operation: 'process_case', case_path: casePath, output_path: outputPath }, 600_000);
  }

  private run<T>(request: WorkerRequest, timeoutMs: number): Promise<T> {
    const python = process.env.DEID_WORKER_PYTHON ?? 'python3';
    const script = process.env.DEID_WORKER_SCRIPT ?? resolve(__dirname, '../../../workers/deid_worker.py');

    return new Promise<T>((resolveResult, reject) => {
      const child = spawn(python, [script], {
        env: {
          PATH: process.env.PATH,
          PYTHONUNBUFFERED: '1',
          DICOM_UID_SECRET: process.env.DICOM_UID_SECRET,
          PADDLE_HOME: process.env.PADDLE_HOME,
          PADDLE_PDX_MODEL_SOURCE: process.env.PADDLE_PDX_MODEL_SOURCE,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new ServiceUnavailableException('本地脱敏进程超时'));
      }, timeoutMs);

      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolveResult(value as T);
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 5_000_000) finish(new ServiceUnavailableException('本地脱敏进程输出过大'));
      });
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 4_000) stderr += chunk;
      });
      child.on('error', () => finish(new ServiceUnavailableException('本地脱敏进程不可用')));
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) return finish(new ServiceUnavailableException('本地脱敏进程执行失败'));
        try {
          const response = JSON.parse(stdout) as WorkerResponse<T>;
          if (!response.ok || response.result === undefined) {
            const errorCode = response.error?.code ?? 'DEIDENTIFICATION_FAILED';
            const message = response.error?.message ?? '脱敏处理失败';
            return finish(new UnprocessableEntityException({ code: errorCode, message }));
          }
          return finish(undefined, response.result);
        } catch {
          return finish(new ServiceUnavailableException('本地脱敏进程返回无效'));
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
