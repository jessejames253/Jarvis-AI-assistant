<div className="patch-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
    <button onClick={onApprove} disabled={resolved} title="Approve this patch — triggers the same flow as typing APPROVE in chat" aria-label="Approve patch">
      {loading ? 'Applying…' : 'Approve'}
    </button>
    <button onClick={onReject} disabled={resolved} title="Reject this patch — discards it without applying any changes" aria-label="Reject patch">
      Reject
    </button>
  </div>