'use client';

import { useState } from 'react';

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid' | 'submitting' | 'submitted';

interface ValidationResult {
  valid: boolean;
  urlType?: string;
  name?: string;
  serviceCount?: number;
  layerCount?: number;
  alreadyIndexed?: boolean;
  lastIndexedAt?: string;
  currentDatasetCount?: number;
  error?: string;
}

interface SubmissionResult {
  success: boolean;
  submissionId?: string;
  position?: number;
  message?: string;
  error?: string;
}

export default function SourceSubmissionForm() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ValidationState>('idle');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [isReindex, setIsReindex] = useState(false);

  const handleValidate = async () => {
    if (!url.trim()) return;

    setState('validating');
    setValidation(null);
    setSubmission(null);

    try {
      const response = await fetch('/api/sources/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const result: ValidationResult = await response.json();
      setValidation(result);
      setState(result.valid ? 'valid' : 'invalid');
    } catch (error) {
      setValidation({ valid: false, error: 'Failed to validate URL' });
      setState('invalid');
    }
  };

  const handleSubmit = async () => {
    if (!validation?.valid) return;

    setState('submitting');

    try {
      const response = await fetch('/api/sources/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), reindex: isReindex }),
      });

      const result: SubmissionResult = await response.json();
      setSubmission(result);
      setState(result.success ? 'submitted' : 'valid');
    } catch (error) {
      setSubmission({ success: false, error: 'Failed to submit URL' });
      setState('valid');
    }
  };

  const handleReset = () => {
    setUrl('');
    setState('idle');
    setValidation(null);
    setSubmission(null);
    setIsReindex(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getUrlTypeLabel = (urlType: string) => {
    switch (urlType) {
      case 'arcgis_server':
        return 'ArcGIS Server';
      case 'single_service':
        return 'Feature/Map Service';
      case 'hub':
        return 'Open Data Hub';
      default:
        return urlType;
    }
  };

  return (
    <div className="space-y-6">
      {/* URL Input */}
      <div className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-6 border border-gray-300 dark:border-slate-700">
        <label htmlFor="url-input" className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
          Data Source URL
        </label>
        <div className="flex gap-3">
          <input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://gis.example.gov/arcgis/rest/services"
            className="flex-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-teal dark:focus:border-teal-light focus:ring-1 focus:ring-teal dark:focus:ring-teal-light"
            disabled={state === 'validating' || state === 'submitting' || state === 'submitted'}
          />
          <button
            onClick={handleValidate}
            disabled={!url.trim() || state === 'validating' || state === 'submitting' || state === 'submitted'}
            className="px-6 py-3 bg-teal text-white font-medium rounded-lg hover:bg-teal-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === 'validating' ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Checking...
              </span>
            ) : (
              'Validate'
            )}
          </button>
        </div>
      </div>

      {/* Validation Result */}
      {validation && state !== 'submitted' && (
        <div
          className={`rounded-lg p-6 border ${
            validation.valid
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700'
              : 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700'
          }`}
        >
          {validation.valid ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-emerald-600 dark:text-emerald-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="font-medium text-emerald-600 dark:text-emerald-400">
                    {getUrlTypeLabel(validation.urlType || '')} detected
                  </h3>
                  {validation.name && (
                    <p className="text-gray-900 dark:text-white mt-1">&quot;{validation.name}&quot;</p>
                  )}
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-2 space-y-1">
                    {validation.serviceCount !== undefined && validation.serviceCount > 0 && (
                      <p>Found {validation.serviceCount} service(s)</p>
                    )}
                    {validation.layerCount !== undefined && validation.layerCount > 0 && (
                      <p>Found {validation.layerCount} layer(s)</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Already indexed notice */}
              {validation.alreadyIndexed && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-lg p-4 mt-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-amber-600 dark:text-amber-400 font-medium">Already indexed</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        We have {validation.currentDatasetCount} dataset(s) from this source.
                        {validation.lastIndexedAt && (
                          <> Last indexed: {formatDate(validation.lastIndexedAt)}</>
                        )}
                      </p>
                      <label className="flex items-center gap-2 mt-3 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isReindex}
                          onChange={(e) => setIsReindex(e.target.checked)}
                          className="rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-teal dark:text-teal-light focus:ring-teal dark:focus:ring-teal-light"
                        />
                        Request re-index to refresh the data
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit button */}
              <div className="pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={state === 'submitting' || (validation.alreadyIndexed && !isReindex)}
                  className="px-6 py-3 bg-coral text-white font-medium rounded-lg hover:bg-coral-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {state === 'submitting' ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Submitting...
                    </span>
                  ) : validation.alreadyIndexed ? (
                    isReindex ? 'Request Re-index' : 'Already Indexed'
                  ) : (
                    'Add to Index Queue'
                  )}
                </button>
              </div>

              {/* Submission error */}
              {submission && !submission.success && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700 rounded-lg p-4 mt-4">
                  <p className="text-red-600 dark:text-red-400">{submission.error}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-medium text-red-600 dark:text-red-400">Validation failed</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{validation.error}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success state */}
      {state === 'submitted' && submission?.success && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-emerald-600 dark:text-emerald-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="font-medium text-emerald-600 dark:text-emerald-400">Submitted successfully!</h3>
              <p className="text-gray-600 dark:text-gray-300 mt-1">{submission.message}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Submission ID: <code className="text-teal dark:text-teal-light">{submission.submissionId}</code>
              </p>
              <button
                onClick={handleReset}
                className="mt-4 px-4 py-2 text-sm text-teal dark:text-teal-light hover:text-gray-900 dark:hover:text-white border border-teal dark:border-teal-light hover:border-gray-900 dark:hover:border-white rounded-lg transition-colors"
              >
                Submit another URL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
