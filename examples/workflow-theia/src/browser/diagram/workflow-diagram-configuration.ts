/********************************************************************************
 * Copyright (c) 2019-2023 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { createWorkflowDiagramContainer } from '@eclipse-glsp-examples/workflow-glsp/lib';
import { configureDiagramServer, GLSPDiagramConfiguration, GLSPTheiaDiagramServer } from '@eclipse-glsp/theia-integration';
import { Container, injectable } from '@theia/core/shared/inversify';

import { WorkflowLanguage } from '../../common/workflow-language';

@injectable()
export class WorkflowDiagramConfiguration extends GLSPDiagramConfiguration {
    diagramType: string = WorkflowLanguage.diagramType;

    doCreateContainer(widgetId: string): Container {
        const container = createWorkflowDiagramContainer(widgetId);
        configureDiagramServer(container, GLSPTheiaDiagramServer);
        return container;
    }
}
