/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

export interface Schema {
    project?: string;
    provider: ('both' | 'aws' | 'gcloud' | 'firebase');
    skipInstall: boolean;
    directory: string;
    firebaseProject: string;
}