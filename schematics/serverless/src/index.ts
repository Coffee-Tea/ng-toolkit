import {
    apply, chain, mergeWith, move, Rule, Tree, url, MergeStrategy, SchematicContext, SchematicsException
} from '@angular-devkit/schematics';
import {
    addDependencyToPackageJson, addOrReplaceScriptInPackageJson, addOpenCollective, updateGitIgnore
} from '@ng-toolkit/_utils';
import { getFileContent } from '@schematics/angular/utility/test';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';

export default function addServerless(options: any): Rule {
    options.serverless = {
        aws: {},
        gcloud: {}
    };
    const rules: Rule[] = [];

    const templateSource = apply(url('files/common'), [
        move(options.directory),
    ]);

    //common actions
    rules.push(mergeWith(templateSource, MergeStrategy.Overwrite));

    rules.push(addOrReplaceScriptInPackageJson(options,"build:deploy", "npm run build:prod && npm run deploy"));

    rules.push(addDependencyToPackageJson(options, 'ts-loader', '4.2.0', true));
    rules.push(addDependencyToPackageJson(options, 'webpack-cli', '2.1.2', true));
    rules.push(addDependencyToPackageJson(options, 'cors', '~2.8.4'));

    rules.push(addOpenCollective(options));
    rules.push(addBuildScriptsAndFiles(options));

    if (options.provider === 'firebase') {

        rules.push(updateGitIgnore(options, '/functions/node_modules/'));

        const source = apply(url('./files/firebase'), [
            move(options.directory)
        ]);

        rules.push(tree => {
            tree.create(`${options.directory}/functions/package.json`,`{
  "name": "functions",
  "description": "Cloud Functions for Firebase",
  "scripts": {
    "serve": "firebase serve --only functions",
    "shell": "firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log"
  },
  "dependencies": {
    "firebase-admin": "~5.12.0",
    "firebase-functions": "^1.0.1"
  },
  "private": true
}
`);
            let firebaseProjectSettings = {};
            if (options.firebaseProject) {
                firebaseProjectSettings = {
                    projects: {
                        default: options.firebaseProject
                    }
                };
            }
            tree.create(`${options.directory}/.firebaserc`, JSON.stringify(firebaseProjectSettings, null, "  "));
        });

        rules.push(addOrReplaceScriptInPackageJson(options, 'build:deploy', 'cd functions && npm install && cd .. && firebase deploy'));

        rules.push(mergeWith(source, MergeStrategy.Overwrite));

        rules.push((tree => {
            //outputPath
            const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
            const project: any = cliConfig.projects[options.project].architect;
            for (let property in project) {
                if (project.hasOwnProperty(property) && project[property].builder.indexOf('@angular-devkit/build-angular') > -1) {
                    project[property].options.outputPath = 'functions/' + project[property].options.outputPath;;
                }
            }

            tree.overwrite(`${options.directory}/angular.json`, JSON.stringify(cliConfig, null, "  "));
            return tree;
        }));
    }

    if (options.provider === 'gcloud' || options.provider === 'aws' ) {
        //serverless stuff
        rules.push(addOrReplaceScriptInPackageJson(options, "deploy", "serverless deploy"));
        rules.push(addDependencyToPackageJson(options, 'serverless', '1.26.1', true));

        if (options.provider === 'gcloud') {
            rules.push(addServerlessGcloud(options));
        } else if (options.provider === 'aws') {
            rules.push(addServerlessAWS(options));
        } else {
            options.serverless.aws.filename = 'serverless-aws.yml';
            options.serverless.gcloud.filename = 'serverless-gcloud.yml';
            rules.push(addServerlessAWS(options));
            rules.push(addServerlessGcloud(options));
            rules.push((tree: Tree) => {
                //add scripts to package.json
                const packageJsonSource = JSON.parse(getFileContent(tree, `${options.directory}/package.json`));
                delete packageJsonSource.scripts['build:deploy'];

                packageJsonSource.scripts['build:deploy:aws'] = 'npm run build:prod && npm run deploy:aws';
                packageJsonSource.scripts['build:deploy:gcloud'] = 'npm run build:prod && npm run deploy:gcloud';
                packageJsonSource.scripts['deploy:aws'] = 'cp-cli serverless-aws.yml serverless.yml && npm run deploy';
                packageJsonSource.scripts['deploy:gcloud'] = 'cp-cli serverless-gcloud.yml serverless.yml && npm run deploy';

                tree.overwrite(`${options.directory}/package.json`, JSON.stringify(packageJsonSource, null, "  "));

                return tree;
            });
        }
    }

    rules.push(tree => {
        let localJS = getFileContent(tree, `${options.directory}/local.js`);
        tree.overwrite(`${options.directory}/local.js`, localJS.replace("__distFolder__", getDistFolder(tree, options)));

        let webpack = getFileContent(tree, `${options.directory}/webpack.server.config.js`);
        tree.overwrite(`${options.directory}/webpack.server.config.js`, webpack.replace("__distFolder__", getDistFolder(tree, options)));
    });

    if (!options.skipInstall) {
        rules.push((tree: Tree, context: SchematicContext) => {
            tree.exists('.'); // noop
            context.addTask(new NodePackageInstallTask(options.directory));
        })
    }
    return chain(rules);
}

function addBuildScriptsAndFiles(options: any): Rule {
    return (tree: Tree) => {
        const packageJsonSource = JSON.parse(getFileContent(tree, `${options.directory}/package.json`));

        const universal:boolean = isUniversal(tree, options);
        if(universal) {
            packageJsonSource.scripts['build:client-and-server-bundles'] = 'ng build --prod && ng run application:server';
            packageJsonSource.scripts['build:prod'] = 'npm run build:client-and-server-bundles && webpack --config webpack.server.config.js --progress --colors';
            tree.rename(`${options.directory}/server_universal.ts`, `${options.directory}/server.ts`);
            tree.rename(`${options.directory}/server_static.ts`, `${options.directory}/temp/server_static.ts${new Date().getDate()}`);
        } else {
            packageJsonSource.scripts['build:prod'] = 'ng build --prod && webpack --config webpack.server.config.js --progress --colors';
            tree.rename(`${options.directory}/server_universal.ts`, `${options.directory}temp/server_universal.ts${new Date().getDate()}`);
            tree.rename(`${options.directory}/server_static.ts`, `${options.directory}/server.ts`);
        }

        tree.overwrite(`${options.directory}/package.json`, JSON.stringify(packageJsonSource, null, "  "));

        const serverFileContent = getFileContent(tree, `${options.directory}/server.ts`);

        tree.overwrite(`${options.directory}/server.ts`, serverFileContent
            .replace('__distBrowserFolder__', getBrowserDistFolder(tree, options))
            .replace('__distServerFolder__', getServerDistFolder(tree, options))
        );

        return tree;
    }
}

function addServerlessAWS(options: any): Rule {
    const fileName = options.serverless.aws.filename || 'serverless.yml';

    const source = apply(url('./files/aws'), [
        move(options.directory)
    ]);

    return chain([
        mergeWith(source),
        tree => {
            tree.rename(`${options.directory}/serverless-aws.yml`, `${options.directory}/${fileName}`);
            tree.overwrite(`${options.directory}/${fileName}`, getFileContent(tree,`${options.directory}/${fileName}`).replace('__appName__', options.project));
            return tree;
        },

        addDependencyToPackageJson(options, 'aws-serverless-express', '^3.2.0' ),
        addDependencyToPackageJson(options, 'serverless-apigw-binary', '^0.4.4', true )
    ]);
}

function addServerlessGcloud(options: any): Rule {
    const fileName = options.serverless.gcloud.filename || 'serverless.yml';

    const source = apply(url('./files/gcloud'), [
        move(options.directory)
    ]);

    return chain([
        mergeWith(source),
        tree => {
            tree.rename(`${options.directory}/serverless-gcloud.yml`, `${options.directory}/${fileName}`);
            tree.overwrite(`${options.directory}/${fileName}`, getFileContent(tree,`${options.directory}/${fileName}`).replace('__appName__', options.project));
            return tree;
        },

        addDependencyToPackageJson(options, 'firebase-admin', '^5.11.0' ),
        addDependencyToPackageJson(options, 'firebase-functions', '^0.9.1' ),
        addDependencyToPackageJson(options, 'serverless-google-cloudfunctions', '^1.1.1', true )
    ]);
}

function isUniversal(tree: Tree, options: any): boolean {
    const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
    const project: any = cliConfig.projects[options.project].architect;
    for (let property in project) {
        if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:server') {
            return true;
        }
    }
    return false;
}

function getServerDistFolder(tree: Tree, options: any): string {
    const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
    const project: any = cliConfig.projects[options.project].architect;
    for (let property in project) {
        if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:server') {
            return project[property].options.outputPath;
        }
    }
    return '';
}

function getBrowserDistFolder(tree: Tree, options: any): string {
    const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
    const project: any = cliConfig.projects[options.project].architect;
    for (let property in project) {
        if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:browser') {
            return project[property].options.outputPath;
        }
    }
    throw new SchematicsException('browser nor server builder not found!');
}

function getDistFolder(tree: Tree, options: any): string {
    if (isUniversal(tree, options)) {
        let array = [getServerDistFolder(tree, options), getBrowserDistFolder(tree, options)]
        let A = array.concat().sort(),
            a1 = A[0], a2 = A[A.length - 1], L = a1.length, i = 0;
        while (i < L && a1.charAt(i) === a2.charAt(i)) i++;

        return a1.substring(0, i);
    } else {
        return getBrowserDistFolder(tree, options).substr(0, getBrowserDistFolder(tree,options).lastIndexOf('/'));
    }
}

// function updateIndexFile(options: any): Rule {
//     return tree => {
//         const cliConfig: any = JSON.parse(getFileContent(tree, `${options.directory}/angular.json`));
//         const project: any = cliConfig.projects[options.project].architect;
//         let indexFilePath;
//         for (let property in project) {
//             if (project.hasOwnProperty(property) && project[property].builder === '@angular-devkit/build-angular:browser') {
//                 indexFilePath = project[property].options.index;
//             }
//         }
//
//         tree.overwrite(`${options.directory}/${indexFilePath}`, indexContent);
//
//         return tree;
//     }
// }