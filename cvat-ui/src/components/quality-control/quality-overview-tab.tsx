// Copyright (C) CVAT.ai Corporation
// Copyright (C) Shofo
//
// SPDX-License-Identifier: MIT

import React, {
    useEffect, useMemo, useState, useCallback,
} from 'react';
import { useHistory } from 'react-router';
import dayjs from 'dayjs';
import { Row, Col } from 'antd/lib/grid';
import Table from 'antd/lib/table';
import Button from 'antd/lib/button';
import Tag from 'antd/lib/tag';
import Typography from 'antd/lib/typography';
import notification from 'antd/lib/notification';
import {
    ReloadOutlined, DownloadOutlined, AimOutlined,
} from '@ant-design/icons';

import {
    Project, QualitySettings, Task, Job, JobType,
    QualityReport, QualityConflict, getCore,
} from 'cvat-core-wrapper';
import CVATLoadingSpinner from 'components/common/loading-spinner';
import CVATTooltip from 'components/common/cvat-tooltip';

const core = getCore();
const { Text } = Typography;

interface Props {
    instance: Project | Task;
    qualitySettings: {
        settings: QualitySettings | null;
        childrenSettings: QualitySettings[] | null;
    };
}

interface JobRow {
    key: number;
    jobId: number;
    stage: string;
    assignee: string;
    coverageText: string;
    conflicts: number;
    quality: number | null;
    report: QualityReport | null;
}

function fmtPct(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '-';
    return `${(value * 100).toFixed(1)}%`;
}

function qualityColor(value: number | null, threshold: number): string {
    if (value == null || !Number.isFinite(value)) return '#bfbfbf';
    if (value >= threshold) return '#52c41a';
    if (value >= threshold * 0.8) return '#faad14';
    return '#ff4d4f';
}

function downloadReportJson(report: QualityReport, filenameBase: string): void {
    const payload = {
        id: report.id,
        target: report.target,
        created_date: report.createdDate,
        gt_last_updated: report.gtLastUpdated,
        summary: report.summary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function QualityOverviewTab(props: Readonly<Props>): JSX.Element {
    const { instance, qualitySettings } = props;
    const history = useHistory();
    const isTask = instance instanceof Task;
    const targetMetricThreshold = qualitySettings.settings?.targetMetricThreshold ?? 0.7;

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [refreshTick, setRefreshTick] = useState(0);
    const [taskReport, setTaskReport] = useState<QualityReport | null>(null);
    const [jobReports, setJobReports] = useState<QualityReport[]>([]);
    const [conflictsByJob, setConflictsByJob] = useState<Record<number, QualityConflict[]>>({});
    const [issueStats, setIssueStats] = useState<{ total: number; resolved: number }>({ total: 0, resolved: 0 });
    const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
    const [generating, setGenerating] = useState(false);

    const triggerReport = useCallback(async (): Promise<void> => {
        const payload = isTask ? { task_id: instance.id } : { project_id: instance.id };
        setGenerating(true);
        try {
            await (core as any).server.request('/api/quality/reports', {
                method: 'POST',
                data: payload,
            });
            notification.info({
                message: 'Quality report generation started',
                description: 'This can take 30-60 seconds. The page will auto-refresh when done.',
            });
            setTimeout(() => setRefreshTick((n) => n + 1), 30000);
            setTimeout(() => setRefreshTick((n) => n + 1), 60000);
        } catch (err: any) {
            notification.error({
                message: 'Failed to start report generation',
                description: err?.message ?? 'Unknown error',
            });
        } finally {
            setGenerating(false);
        }
    }, [isTask, instance]);

    const gtJob: Job | null = useMemo(() => {
        if (!isTask) return null;
        return (instance as Task).jobs.find((j: Job) => j.type === JobType.GROUND_TRUTH) ?? null;
    }, [instance, isTask]);

    const annotationJobs: Job[] = useMemo(() => {
        if (!isTask) return [];
        return (instance as Task).jobs.filter((j: Job) => j.type !== JobType.GROUND_TRUTH);
    }, [instance, isTask]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);

        (async () => {
            try {
                const filter = isTask ?
                    { taskID: instance.id, target: 'task' } :
                    { projectID: instance.id, target: 'project' };
                const [report] = await core.analytics.quality.reports(filter);

                let childReports: QualityReport[] = [];
                if (report) {
                    childReports = await core.analytics.quality.reports({
                        parentID: report.id,
                        target: isTask ? 'job' : 'task',
                    });
                }

                const conflictsMap: Record<number, QualityConflict[]> = {};
                if (isTask) {
                    await Promise.all(childReports.map(async (r) => {
                        if (r.summary.conflictCount > 0) {
                            try {
                                const rows = await core.analytics.quality.conflicts({ reportID: r.id });
                                conflictsMap[r.jobID] = rows;
                            } catch {
                                conflictsMap[r.jobID] = [];
                            }
                        }
                    }));
                }

                let issues = { total: 0, resolved: 0 };
                if (isTask) {
                    try {
                        const all = await (instance as Task).issues();
                        issues = {
                            total: all.length,
                            resolved: all.filter((i: any) => i.resolved).length,
                        };
                    } catch {
                        // ignore issue fetch errors
                    }
                }

                if (cancelled) return;
                setTaskReport(report ?? null);
                setJobReports(childReports);
                setConflictsByJob(conflictsMap);
                setIssueStats(issues);
            } catch (err: any) {
                if (!cancelled) {
                    const msg = err?.message ?? 'Unknown error';
                    setLoadError(msg);
                    notification.error({
                        message: 'Failed to load quality report',
                        description: msg,
                    });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [instance, isTask, refreshTick]);

    const jumpToFrame = useCallback((jobId: number, frame: number): void => {
        history.push(`/tasks/${(instance as Task).id}/jobs/${jobId}?frame=${frame}`);
    }, [history, instance]);

    const jumpToConflict = useCallback((conflict: QualityConflict, fallbackJobId: number): void => {
        const ann = conflict.annotationConflicts[0];
        const targetJobId = ann?.jobID ?? fallbackJobId;
        const params = new URLSearchParams({ frame: String(conflict.frame) });
        if (ann?.type) params.set('type', ann.type);
        if (ann?.serverID != null) params.set('serverID', String(ann.serverID));
        history.push(`/tasks/${(instance as Task).id}/jobs/${targetJobId}?${params.toString()}`);
    }, [history, instance]);

    const rows: JobRow[] = useMemo(() => {
        const reportByJob: Record<number, QualityReport> = {};
        jobReports.forEach((r) => { reportByJob[r.jobID] = r; });

        return annotationJobs.map((job: Job) => {
            const r = reportByJob[job.id] ?? null;
            const summary = r?.summary;
            const frameShare = summary?.validationFrameShare;
            const validationFrames = summary?.validationFrames;
            const coverageText = validationFrames != null && frameShare != null ?
                `${validationFrames} (${(frameShare * 100).toFixed(1)}%)` : '-';
            return {
                key: job.id,
                jobId: job.id,
                stage: job.stage,
                assignee: job.assignee?.username ?? '',
                coverageText,
                conflicts: summary?.conflictCount ?? 0,
                quality: summary?.accuracy ?? null,
                report: r,
            };
        });
    }, [annotationJobs, jobReports]);

    if (loading) {
        return (
            <div className='cvat-quality-overview-tab'>
                <div className='cvat-quality-control-loading'>
                    <CVATLoadingSpinner />
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className='cvat-quality-overview-tab' style={{ padding: 16 }}>
                <Text type='danger'>{`Could not load quality report: ${loadError}`}</Text>
            </div>
        );
    }

    if (!taskReport) {
        const hasGtJob = isTask && gtJob !== null;
        return (
            <div className='cvat-quality-overview-tab' style={{ padding: 16 }}>
                {hasGtJob ? (
                    <>
                        <Text type='secondary' style={{ display: 'block', marginBottom: 12 }}>
                            Quality report has not been generated yet. Click Generate to queue a
                            report — this compares each annotation job to the Ground Truth job.
                        </Text>
                        <Button
                            type='primary'
                            loading={generating}
                            onClick={triggerReport}
                        >
                            Generate report
                        </Button>
                    </>
                ) : (
                    <Text type='secondary'>
                        This task has no Ground Truth job yet. Create one from the task page
                        (Actions → Create ground truth job) to start measuring annotation quality.
                    </Text>
                )}
            </div>
        );
    }

    const summary = taskReport.summary;
    const errorCount = summary.errorCount ?? 0;
    const warningCount = summary.warningCount ?? 0;
    const errorShare = summary.conflictCount > 0 ?
        `${((errorCount / summary.conflictCount) * 100).toFixed(0)}%` : '0%';
    const createdText = dayjs(taskReport.createdDate).fromNow();

    const columns = [
        {
            title: 'ID',
            dataIndex: 'jobId',
            key: 'jobId',
            render: (jobId: number) => (
                <Button
                    type='link'
                    onClick={() => history.push(`/tasks/${(instance as Task).id}/jobs/${jobId}`)}
                >
                    {`#${jobId}`}
                </Button>
            ),
        },
        { title: 'Stage', dataIndex: 'stage', key: 'stage' },
        { title: 'Assignee', dataIndex: 'assignee', key: 'assignee' },
        { title: 'Coverage', dataIndex: 'coverageText', key: 'coverageText' },
        {
            title: 'Conflicts',
            dataIndex: 'conflicts',
            key: 'conflicts',
            render: (count: number, row: JobRow) => {
                if (count === 0) return <Text>0</Text>;
                const isExpanded = expandedJobId === row.jobId;
                return (
                    <Button
                        type='link'
                        onClick={() => setExpandedJobId(isExpanded ? null : row.jobId)}
                    >
                        {`${count} ${isExpanded ? '▲' : '▼'}`}
                    </Button>
                );
            },
        },
        {
            title: 'Quality',
            dataIndex: 'quality',
            key: 'quality',
            render: (value: number | null) => (
                <Tag
                    color={qualityColor(value, targetMetricThreshold)}
                    style={{ color: '#fff', fontWeight: 500 }}
                >
                    {fmtPct(value)}
                </Tag>
            ),
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, row: JobRow) => (
                row.report ? (
                    <CVATTooltip title='Download job report JSON'>
                        <Button
                            type='text'
                            icon={<DownloadOutlined />}
                            onClick={() => downloadReportJson(row.report as QualityReport, `quality-job-${row.jobId}`)}
                        />
                    </CVATTooltip>
                ) : null
            ),
        },
    ];

    return (
        <div className='cvat-quality-overview-tab'>
            <Row justify='space-between' align='middle' style={{ marginBottom: 16 }}>
                <Col>
                    <CVATTooltip title='Regenerate the quality report (compares current annotations to GT)'>
                        <Button
                            icon={<ReloadOutlined />}
                            loading={generating}
                            onClick={triggerReport}
                        />
                    </CVATTooltip>
                    <Text type='secondary' style={{ marginLeft: 8 }}>{`Created ${createdText}`}</Text>
                </Col>
                <Col>
                    <Button
                        type='link'
                        icon={<DownloadOutlined />}
                        onClick={() => downloadReportJson(taskReport, `quality-${isTask ? 'task' : 'project'}-${instance.id}`)}
                    >
                        Download
                    </Button>
                </Col>
            </Row>

            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}>
                    <div className='cvat-quality-hero-card'>
                        <Text type='secondary'>Mean annotation quality</Text>
                        <div className='cvat-quality-hero-card-value'>{fmtPct(summary.accuracy)}</div>
                    </div>
                </Col>
                <Col span={8}>
                    <div className='cvat-quality-hero-card'>
                        <Text type='secondary'>GT Conflicts</Text>
                        <div className='cvat-quality-hero-card-value'>{summary.conflictCount}</div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {`Errors: ${errorCount} (${errorShare}), Warnings: ${warningCount}`}
                        </Text>
                    </div>
                </Col>
                <Col span={8}>
                    <div className='cvat-quality-hero-card'>
                        <Text type='secondary'>Issues</Text>
                        <div className='cvat-quality-hero-card-value'>{issueStats.total}</div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {`Resolved: ${issueStats.resolved}`}
                        </Text>
                    </div>
                </Col>
            </Row>

            {isTask && gtJob && (
                <div className='cvat-quality-gt-job-card' style={{
                    border: '1px solid #e8e8e8', borderRadius: 4, padding: 12, marginBottom: 16,
                }}>
                    <Row justify='space-between' align='middle'>
                        <Col>
                            <Button
                                type='link'
                                style={{ padding: 0, fontSize: 15 }}
                                onClick={() => history.push(`/tasks/${(instance as Task).id}/jobs/${gtJob.id}`)}
                            >
                                {`Job #${gtJob.id}`}
                            </Button>
                            <Tag color='orange' style={{ marginLeft: 8 }}>Ground truth</Tag>
                            <div style={{ marginTop: 4 }}>
                                <Text type='secondary'>{`Stage: ${gtJob.stage} · State: ${gtJob.state}`}</Text>
                            </div>
                        </Col>
                        <Col>
                            <Text type='secondary'>
                                {`Frames: ${summary.validationFrames ?? '-'} `}
                                {summary.validationFrameShare != null &&
                                    `(${(summary.validationFrameShare * 100).toFixed(1)}%)`}
                            </Text>
                        </Col>
                    </Row>
                </div>
            )}

            <Table
                className='cvat-quality-jobs-table'
                columns={columns}
                dataSource={rows}
                pagination={{ pageSize: 10 }}
                expandable={{
                    expandedRowKeys: expandedJobId != null ? [expandedJobId] : [],
                    showExpandColumn: false,
                    expandedRowRender: (row: JobRow) => {
                        const conflicts = conflictsByJob[row.jobId] ?? [];
                        if (conflicts.length === 0) {
                            return <Text type='secondary'>No conflict details available.</Text>;
                        }
                        return (
                            <div style={{ padding: '4px 0' }}>
                                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                    {`Conflicts in job #${row.jobId}`}
                                </Text>
                                {conflicts.map((c) => {
                                    const ann = c.annotationConflicts[0];
                                    const destLabel = ann?.jobID === row.jobId ? 'annotator' : 'GT';
                                    return (
                                        <Row
                                            key={c.id}
                                            align='middle'
                                            gutter={8}
                                            style={{
                                                padding: '4px 0',
                                                borderBottom: '1px solid #f0f0f0',
                                            }}
                                        >
                                            <Col flex='80px'>
                                                <Button
                                                    type='link'
                                                    size='small'
                                                    icon={<AimOutlined />}
                                                    onClick={() => jumpToConflict(c, row.jobId)}
                                                >
                                                    {`#${c.frame}`}
                                                </Button>
                                            </Col>
                                            <Col flex='auto'>
                                                <Text>{c.description}</Text>
                                                <Text type='secondary' style={{ marginLeft: 6, fontSize: 12 }}>
                                                    {`(opens in ${destLabel} job)`}
                                                </Text>
                                            </Col>
                                            <Col flex='90px' style={{ textAlign: 'right' }}>
                                                <Tag color={c.severity === 'error' ? 'red' : 'orange'}>
                                                    {c.severity}
                                                </Tag>
                                            </Col>
                                        </Row>
                                    );
                                })}
                            </div>
                        );
                    },
                }}
            />
        </div>
    );
}

export default React.memo(QualityOverviewTab);
