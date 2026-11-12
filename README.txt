balloon パスワード直接変更アップデート

GitHubへアップロードするファイルは以下の2個だけです。
・index.html
・app.js

手順：
1) balloon リポジトリの Code → Add file → Upload files に進む
2) この2ファイルをアップロードして同名ファイルを置き換える
3) Commit changes を押す
4) 公開されたアプリを開き直し、ログイン → 設定 → アカウント → パスワードを変更
5) 現在のパスワード、新しいパスワード（8文字以上・英大文字・数字あり）、確認を入力

メールを使わず、Firebase Authenticationの再認証とupdatePasswordで変更します。
ログインできなくなった場合の「パスワードを忘れた場合」メール再設定機能は残ります。

※ firebase-config.js、calculator.js、styles.css、balloon-theme.css、アイコン画像、Firestoreルールは変更しません。
※ 公開中サイトの内容を取得できなかったため、以前作成したパスワード再設定対応版を基にしています。GitHub上で個別に追加した変更がある場合、アップロード前に差分を確認してください。
