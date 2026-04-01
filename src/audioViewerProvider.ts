import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from './utils/fileUtils';
import { TemplateUtils } from './utils/templateUtils';
import { MessageHandler } from './utils/messageHandler';
import { configureWebview, createReadonlyDocument, renderErrorHtml, rerouteIfNeeded } from './viewerProviderUtils';

export class AudioViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'omni-viewer.audioViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return createReadonlyDocument(uri);
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        configureWebview(this.context, webviewPanel);

        const audioUri = document.uri;
        const audioPath = audioUri.fsPath;
        const audioFileName = path.basename(audioPath);

        try {
            webviewPanel.webview.options = {
                ...webviewPanel.webview.options,
                localResourceRoots: [
                    ...(webviewPanel.webview.options.localResourceRoots || []),
                    vscode.Uri.file(path.dirname(audioPath)),
                    audioUri
                ]
            };

            if (await rerouteIfNeeded(audioUri, AudioViewerProvider.viewType, webviewPanel)) {
                return;
            }

            const metadata = await FileUtils.getAudioMetadata(audioPath);
            const audioSrc = webviewPanel.webview.asWebviewUri(audioUri).toString();

            const html = await TemplateUtils.loadTemplate(this.context, 'audio/audioViewer.html', {
                fileName: audioFileName,
                audioSrc,
                metadata: JSON.stringify({
                    ...metadata,
                    fileName: audioFileName,
                    audioSrc
                })
            });

            webviewPanel.webview.html = html;

            MessageHandler.setupMessageListener(webviewPanel.webview, document.uri);

        } catch (error) {
            console.error('Error setting up audio viewer:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = renderErrorHtml(audioFileName, errorMessage, {
                title: 'Failed to load audio file',
                message: 'Unable to load the audio file due to an error:',
                icon: '🎵'
            });
        }
    }
}
