// Copyright (C) Shofo
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import Button from 'antd/lib/button';
import Input from 'antd/lib/input';
import InputNumber from 'antd/lib/input-number';
import { Row, Col } from 'antd/lib/grid';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';
import {
    PlusOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined,
    PlayCircleOutlined, PauseCircleOutlined,
} from '@ant-design/icons';

import { changeFrameAsync, switchPlay } from 'actions/annotation-actions';
import { CombinedState } from 'reducers';
import { getCore, TemporalDescription } from 'cvat-core-wrapper';

const core = getCore();

const DRAFT_FIELDS = ['action', 'intent', 'scene', 'objects'] as const;
type DraftFields = Partial<Record<(typeof DRAFT_FIELDS)[number], string>>;

interface DraftState {
    id?: number;
    frame_start: number;
    frame_end: number;
    text: string;
    structured_fields: DraftFields;
}

function emptyDraft(frame: number): DraftState {
    return {
        frame_start: frame,
        frame_end: frame,
        text: '',
        structured_fields: {},
    };
}

export default function TemporalDescriptionsList(): JSX.Element {
    const dispatch = useDispatch();
    const { jobId, frame, startFrame, stopFrame, playing } = useSelector((state: CombinedState) => ({
        jobId: state.annotation.job.instance?.id as number | undefined,
        frame: state.annotation.player.frame.number,
        startFrame: state.annotation.job.instance?.startFrame ?? 0,
        stopFrame: state.annotation.job.instance?.stopFrame ?? 0,
        playing: state.annotation.player.playing,
    }), shallowEqual);

    const [descriptions, setDescriptions] = useState<TemporalDescription[]>([]);
    const [loading, setLoading] = useState(false);
    const [draft, setDraft] = useState<DraftState | null>(null);
    const previewRef = useRef<{ id: number; end: number } | null>(null);
    const [previewingId, setPreviewingId] = useState<number | null>(null);

    useEffect(() => {
        const preview = previewRef.current;
        if (preview && frame >= preview.end) {
            dispatch(switchPlay(false));
            previewRef.current = null;
            setPreviewingId(null);
        }
    }, [frame, dispatch]);

    useEffect(() => {
        if (!playing && previewRef.current) {
            previewRef.current = null;
            setPreviewingId(null);
        }
    }, [playing]);

    const preview = (desc: TemporalDescription): void => {
        if (previewingId === desc.id) {
            dispatch(switchPlay(false));
            previewRef.current = null;
            setPreviewingId(null);
            return;
        }
        previewRef.current = { id: desc.id, end: desc.frame_end };
        setPreviewingId(desc.id);
        dispatch(changeFrameAsync(desc.frame_start));
        dispatch(switchPlay(true));
    };

    const load = useCallback(async () => {
        if (!jobId) return;
        setLoading(true);
        try {
            const rows = await core.temporalDescriptions.get({ job_id: jobId });
            setDescriptions(rows);
        } catch (err: any) {
            notification.error({ message: 'Failed to load descriptions', description: err?.message });
        } finally {
            setLoading(false);
        }
    }, [jobId]);

    useEffect(() => { load(); }, [load]);

    const save = async (): Promise<void> => {
        if (!draft || !jobId) return;
        try {
            if (draft.id != null) {
                await core.temporalDescriptions.update(draft.id, {
                    frame_start: draft.frame_start,
                    frame_end: draft.frame_end,
                    text: draft.text,
                    structured_fields: draft.structured_fields as Record<string, unknown>,
                });
            } else {
                await core.temporalDescriptions.create({
                    job: jobId,
                    frame_start: draft.frame_start,
                    frame_end: draft.frame_end,
                    text: draft.text,
                    structured_fields: draft.structured_fields as Record<string, unknown>,
                });
            }
            setDraft(null);
            await load();
        } catch (err: any) {
            notification.error({ message: 'Failed to save description', description: err?.message });
        }
    };

    const remove = async (id: number): Promise<void> => {
        try {
            await core.temporalDescriptions.delete(id);
            setDescriptions((prev) => prev.filter((d) => d.id !== id));
        } catch (err: any) {
            notification.error({ message: 'Failed to delete description', description: err?.message });
        }
    };

    const beginEdit = (desc: TemporalDescription): void => {
        setDraft({
            id: desc.id,
            frame_start: desc.frame_start,
            frame_end: desc.frame_end,
            text: desc.text,
            structured_fields: (desc.structured_fields || {}) as DraftFields,
        });
    };

    const setStructured = (key: (typeof DRAFT_FIELDS)[number], value: string): void => {
        if (!draft) return;
        setDraft({ ...draft, structured_fields: { ...draft.structured_fields, [key]: value } });
    };

    return (
        <div className='cvat-objects-sidebar-tabs-content' style={{ padding: 8 }}>
            <Row justify='space-between' align='middle' style={{ marginBottom: 8 }}>
                <Col><Text strong>Temporal descriptions</Text></Col>
                <Col>
                    <Button
                        size='small'
                        type='primary'
                        icon={<PlusOutlined />}
                        disabled={!jobId || loading || draft !== null}
                        onClick={() => setDraft(emptyDraft(frame))}
                    >
                        Add
                    </Button>
                </Col>
            </Row>

            {draft && (
                <div className='cvat-temporal-description-editor' style={{
                    border: '1px solid #d9d9d9', borderRadius: 4, padding: 8, marginBottom: 8,
                }}>
                    <Row gutter={8} style={{ marginBottom: 8 }}>
                        <Col span={12}>
                            <Text type='secondary'>Start frame</Text>
                            <InputNumber
                                min={startFrame}
                                max={stopFrame}
                                value={draft.frame_start}
                                onChange={(v) => setDraft({ ...draft, frame_start: (v as number) ?? startFrame })}
                                style={{ width: '100%' }}
                            />
                        </Col>
                        <Col span={12}>
                            <Text type='secondary'>End frame</Text>
                            <InputNumber
                                min={draft.frame_start}
                                max={stopFrame}
                                value={draft.frame_end}
                                onChange={(v) => setDraft({ ...draft, frame_end: (v as number) ?? draft.frame_start })}
                                style={{ width: '100%' }}
                            />
                        </Col>
                    </Row>
                    <Button
                        size='small'
                        style={{ marginBottom: 8 }}
                        onClick={() => setDraft({ ...draft, frame_start: frame })}
                    >
                        Use current ({frame}) as start
                    </Button>
                    <Button
                        size='small'
                        style={{ marginBottom: 8, marginLeft: 4 }}
                        onClick={() => setDraft({ ...draft, frame_end: frame })}
                    >
                        Use current as end
                    </Button>
                    <Input.TextArea
                        rows={3}
                        placeholder='Description (e.g. "Bryan walks toward camera and gestures")'
                        value={draft.text}
                        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                        style={{ marginBottom: 8 }}
                    />
                    {DRAFT_FIELDS.map((key) => (
                        <Input
                            key={key}
                            size='small'
                            placeholder={key}
                            value={draft.structured_fields[key] ?? ''}
                            onChange={(e) => setStructured(key, e.target.value)}
                            style={{ marginBottom: 4 }}
                        />
                    ))}
                    <Row justify='end' gutter={4} style={{ marginTop: 8 }}>
                        <Col>
                            <Button size='small' icon={<CloseOutlined />} onClick={() => setDraft(null)}>Cancel</Button>
                        </Col>
                        <Col>
                            <Button size='small' type='primary' icon={<SaveOutlined />} onClick={save}>Save</Button>
                        </Col>
                    </Row>
                </div>
            )}

            {descriptions.length === 0 && !draft && (
                <Text type='secondary'>No descriptions yet. Click Add to create one.</Text>
            )}

            {descriptions.map((desc) => (
                <div
                    key={desc.id}
                    className='cvat-temporal-description-item'
                    style={{
                        border: '1px solid #f0f0f0', borderRadius: 4, padding: 8,
                        marginBottom: 8, cursor: 'pointer',
                    }}
                    onClick={() => dispatch(changeFrameAsync(desc.frame_start))}
                >
                    <Row justify='space-between' align='middle'>
                        <Col>
                            <Text strong>{`Frames ${desc.frame_start}–${desc.frame_end}`}</Text>
                        </Col>
                        <Col onClick={(e) => e.stopPropagation()}>
                            <Button
                                size='small'
                                type='text'
                                title={previewingId === desc.id ? 'Stop preview' : 'Play this segment'}
                                icon={previewingId === desc.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                                onClick={() => preview(desc)}
                            />
                            <Button
                                size='small'
                                type='text'
                                icon={<EditOutlined />}
                                onClick={() => beginEdit(desc)}
                            />
                            <Button
                                size='small'
                                type='text'
                                icon={<DeleteOutlined />}
                                onClick={() => remove(desc.id)}
                            />
                        </Col>
                    </Row>
                    {desc.text && <div style={{ marginTop: 4 }}><Text>{desc.text}</Text></div>}
                    {desc.structured_fields && Object.entries(desc.structured_fields)
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                            <div key={k}><Text type='secondary'>{`${k}: ${v}`}</Text></div>
                        ))}
                </div>
            ))}
        </div>
    );
}
